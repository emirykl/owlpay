import { describe, expect, it } from 'vitest';
import { BountyResolutionService } from '../src/application/bounty-resolution-service.js';
import { VerificationPolicy } from '../src/application/verification-policy.js';
import type { BountyRepository, GitHubEvidenceProvider, SettlementGateway } from '../src/application/ports.js';
import type { Bounty } from '../src/domain/schemas.js';

const past = '2026-08-01T00:00:00.000Z';
const future = '2026-08-20T00:00:00.000Z';
const now = new Date('2026-08-09T00:00:00.000Z').getTime();

function bounty(overrides: Partial<Bounty>): Bounty {
  return {
    id: 'bounty-1',
    title: 'Fix the health endpoint',
    description: 'The health endpoint should return HTTP 200.',
    repositoryUrl: 'https://github.com/owlpay/demo',
    ownerAddress: '0x0000000000000000000000000000000000000001',
    rewardAmount: '20',
    reviewPlan: 'STANDARD',
    deadline: future,
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
    contributorDeadline: future,
    maintainerReviewDeadline: future,
    revisionExtensionUsed: false,
    timeoutResolution: 'NONE',
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

function repositoryOf(bounties: Bounty[]) {
  const saved: Bounty[] = [];
  const repository: BountyRepository = {
    async list() { return bounties; },
    async listResolvable() { return bounties; },
    async findReviewPaymentConflict() { return false; },
    async get(id) { return bounties.find((item) => item.id === id); },
    async save(item) { saved.push(item); },
    async saveIfStatus(item) { saved.push(item); return true; },
    async saveReviewPayment(item) { saved.push(item); }
  };
  return { repository, saved };
}

function githubThatFailsFor(unreachablePullRequest: string): GitHubEvidenceProvider {
  return {
    async listManageableRepositories() { return []; },
    async assertCanManageRepository(repositoryUrl) {
      return { id: 1, name: 'demo', fullName: 'owlpay/demo', url: repositoryUrl, ownerLogin: 'owlpay', ownerAvatarUrl: null, permission: 'admin' };
    },
    async getPullRequest(pullRequestUrl) {
      if (pullRequestUrl === unreachablePullRequest) throw new Error('GitHub returned 404');
      return {
        repositoryUrl: 'https://github.com/owlpay/demo', pullRequestUrl, number: 42, state: 'open', merged: false,
        headSha: 'a'.repeat(40), changedFiles: 1, additions: 1, deletions: 0, authorId: 202, author: 'developer', title: 'Work', body: ''
      };
    },
    async reviewPullRequest() {
      return { confidence: 0.9, criterionResults: [], blockingIssues: [] };
    }
  };
}

const unreachable = 'https://github.com/owlpay/demo/pull/99';

describe('due bounty resolution reporting', () => {
  it('keeps the bounties it settled when another one fails', async () => {
    const expiring = bounty({ id: 'expires', status: 'ASSIGNED', contributorDeadline: past });
    const broken = bounty({
      id: 'broken',
      maintainerReviewDeadline: past,
      submission: {
        pullRequestUrl: unreachable,
        developerAddress: '0x0000000000000000000000000000000000000003',
        commitSha: 'a'.repeat(40),
        submissionHash: `0x${'b'.repeat(64)}`,
        submittedAt: past
      }
    });
    const { repository, saved } = repositoryOf([expiring, broken]);
    const service = new BountyResolutionService(repository, githubThatFailsFor(unreachable), new VerificationPolicy(), settlement);

    const report = await service.resolveDueBounties(now);

    expect(report.resolved).toEqual([{ id: 'expires', status: 'EXPIRED', resolution: 'NONE' }]);
    expect(report.failed).toEqual([{ id: 'broken', reason: 'GitHub returned 404' }]);
    // The successful settlement has to be persisted even though a later bounty threw.
    expect(saved.map((item) => item.id)).toEqual(['expires']);
  });

  it('reports a clean run with nothing outstanding', async () => {
    const { repository } = repositoryOf([]);
    const service = new BountyResolutionService(repository, githubThatFailsFor(unreachable), new VerificationPolicy(), settlement);

    expect(await service.resolveDueBounties(now)).toEqual({ resolved: [], failed: [] });
  });

  it('names every bounty that could not be settled', async () => {
    const brokenPair = ['broken-1', 'broken-2'].map((id) => bounty({
      id,
      maintainerReviewDeadline: past,
      submission: {
        pullRequestUrl: unreachable,
        developerAddress: '0x0000000000000000000000000000000000000003',
        commitSha: 'a'.repeat(40),
        submissionHash: `0x${'b'.repeat(64)}`,
        submittedAt: past
      }
    }));
    const { repository } = repositoryOf(brokenPair);
    const service = new BountyResolutionService(repository, githubThatFailsFor(unreachable), new VerificationPolicy(), settlement);

    const report = await service.resolveDueBounties(now);

    expect(report.resolved).toEqual([]);
    expect(report.failed.map((item) => item.id)).toEqual(['broken-1', 'broken-2']);
  });
});
