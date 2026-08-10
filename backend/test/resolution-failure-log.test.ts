import { describe, expect, it, vi } from 'vitest';
import { BountyResolutionService } from '../src/application/bounty-resolution-service.js';
import { VerificationPolicy } from '../src/application/verification-policy.js';
import type { BountyRepository, GitHubEvidenceProvider, ResolutionFailureLog, SettlementGateway } from '../src/application/ports.js';
import type { Bounty } from '../src/domain/schemas.js';
import { InMemoryResolutionFailureLog } from '../src/infrastructure/in-memory-resolution-failure-log.js';
import { SupabaseResolutionFailureLog } from '../src/infrastructure/supabase-resolution-failure-log.js';
import { createFakeSupabase } from './helpers/fake-supabase.js';

const past = '2026-08-01T00:00:00.000Z';
const now = new Date('2026-08-09T00:00:00.000Z').getTime();

function bounty(overrides: Partial<Bounty> = {}): Bounty {
  return {
    id: 'bounty-1',
    title: 'Fix the health endpoint',
    description: 'The health endpoint should return HTTP 200.',
    repositoryUrl: 'https://github.com/owlpay/demo',
    ownerAddress: '0x0000000000000000000000000000000000000001',
    rewardAmount: '20',
    reviewPlan: 'STANDARD',
    deadline: past,
    criteria: [],
    status: 'SUBMITTED',
    createdAt: past,
    applicantCount: 0,
    reviewPrice: '1',
    reviewPaidAmount: '0',
    reviewPaymentStatus: 'REQUIRED',
    reviewPaymentTxHashes: [],
    reviewPaymentOrderIds: [],
    revisionRequests: [],
    contributorDeadline: past,
    maintainerReviewDeadline: past,
    revisionExtensionUsed: false,
    timeoutResolution: 'NONE',
    submission: {
      pullRequestUrl: 'https://github.com/owlpay/demo/pull/42',
      developerAddress: '0x0000000000000000000000000000000000000002',
      commitSha: 'a'.repeat(40),
      submissionHash: `0x${'c'.repeat(64)}`,
      author: 'developer',
      changedFiles: 1,
      additions: 1,
      deletions: 0,
      submittedAt: past
    },
    ...overrides
  };
}

const settlement: SettlementGateway = {
  writesEnabled: false,
  async approveAndRelease() { return null; },
  async requestRevision() { return null; },
  async approveAfterTimeout() { return null; },
  async refundAfterTimeout() { return null; }
};

const unreachableGitHub: GitHubEvidenceProvider = {
  async listManageableRepositories() { return []; },
  async assertCanManageRepository(repositoryUrl) {
    return { id: 1, name: 'demo', fullName: 'owlpay/demo', url: repositoryUrl, ownerLogin: 'owlpay', ownerAvatarUrl: null, permission: 'admin' };
  },
  async getPullRequest() { throw new Error('GitHub returned 404'); },
  async reviewPullRequest() { return { confidence: 0.9, criterionResults: [], blockingIssues: [] }; }
};

function repositoryOf(bounties: Bounty[]): BountyRepository {
  return {
    async list() { return bounties; },
    async listResolvable() { return bounties; },
    async findReviewPaymentConflict() { return false; },
    async get(id) { return bounties.find((item) => item.id === id); },
    async save() {},
    async saveIfStatus() { return true; },
    async saveReviewPayment() {}
  };
}

describe('resolution failures outlive the run', () => {
  it('records every bounty the run could not settle', async () => {
    const log = new InMemoryResolutionFailureLog();
    const service = new BountyResolutionService(
      repositoryOf([bounty(), bounty({ id: 'bounty-2' })]),
      unreachableGitHub,
      new VerificationPolicy(),
      settlement,
      log
    );

    const report = await service.resolveDueBounties(now);

    expect(report.failed).toHaveLength(2);
    expect(log.list()).toEqual([
      { bountyId: 'bounty-1', reason: 'GitHub returned 404', runAt: new Date(now).toISOString() },
      { bountyId: 'bounty-2', reason: 'GitHub returned 404', runAt: new Date(now).toISOString() }
    ]);
  });

  it('writes nothing when every bounty settles', async () => {
    const log = new InMemoryResolutionFailureLog();
    const service = new BountyResolutionService(repositoryOf([]), unreachableGitHub, new VerificationPolicy(), settlement, log);

    await service.resolveDueBounties(now);

    expect(log.list()).toEqual([]);
  });

  it('still reports the run when the record cannot be written', async () => {
    const failing: ResolutionFailureLog = { async record() { throw new Error('database unavailable'); } };
    const service = new BountyResolutionService(repositoryOf([bounty()]), unreachableGitHub, new VerificationPolicy(), settlement, failing);

    // Losing the audit trail must never discard the report of work that did
    // happen, so the run has to survive its own bookkeeping failing.
    const report = await service.resolveDueBounties(now);

    expect(report.failed).toEqual([{ id: 'bounty-1', reason: 'GitHub returned 404' }]);
  });

  it('keeps resolving when no log is configured at all', async () => {
    const service = new BountyResolutionService(repositoryOf([bounty()]), unreachableGitHub, new VerificationPolicy(), settlement);

    await expect(service.resolveDueBounties(now)).resolves.toMatchObject({ failed: [{ id: 'bounty-1' }] });
  });

  it('caps what it keeps in memory', async () => {
    const log = new InMemoryResolutionFailureLog(3);

    for (let index = 0; index < 5; index += 1) {
      await log.record([{ bountyId: `bounty-${index}`, reason: 'unreachable' }], new Date(now));
    }

    expect(log.list().map((entry) => entry.bountyId)).toEqual(['bounty-2', 'bounty-3', 'bounty-4']);
  });
});

describe('supabase resolution failure log', () => {
  it('inserts one row per failure', async () => {
    const supabase = createFakeSupabase({ resolution_failures: [] });
    const log = new SupabaseResolutionFailureLog(supabase.client);

    await log.record([{ bountyId: 'bounty-1', reason: 'GitHub returned 404' }], new Date(now));

    expect(supabase.tables.resolution_failures).toEqual([
      { bounty_id: 'bounty-1', reason: 'GitHub returned 404', run_at: new Date(now).toISOString() }
    ]);
  });

  it('swallows a write failure instead of breaking the run', async () => {
    const supabase = createFakeSupabase({ resolution_failures: [] });
    supabase.failNext({ message: 'relation "resolution_failures" does not exist' }, 'resolution_failures');
    const log = new SupabaseResolutionFailureLog(supabase.client);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    // A deployment that has not run migration 0012 yet must keep settling.
    await expect(log.record([{ bountyId: 'bounty-1', reason: 'unreachable' }], new Date(now))).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it('bounds a runaway error message', async () => {
    const supabase = createFakeSupabase({ resolution_failures: [] });
    const log = new SupabaseResolutionFailureLog(supabase.client);

    await log.record([{ bountyId: 'bounty-1', reason: 'x'.repeat(5_000) }], new Date(now));

    expect((supabase.tables.resolution_failures![0] as { reason: string }).reason).toHaveLength(1_000);
  });
});
