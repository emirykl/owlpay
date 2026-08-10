import { describe, expect, it } from 'vitest';
import { BountyResolutionService } from '../src/application/bounty-resolution-service.js';
import { BountyService } from '../src/application/bounty-service.js';
import { VerificationPolicy } from '../src/application/verification-policy.js';
import type { AuthUser } from '../src/application/auth.js';
import type { GitHubEvidenceProvider, SettlementGateway } from '../src/application/ports.js';
import { InMemoryApplicationRepository } from '../src/infrastructure/in-memory-application-repository.js';
import { InMemoryBountyRepository } from '../src/infrastructure/in-memory-bounty-repository.js';
import type { Bounty } from '../src/domain/schemas.js';

const past = '2026-08-01T00:00:00.000Z';
const future = '2026-08-20T00:00:00.000Z';
const owner: AuthUser = { id: 'owner-user', githubId: 101, githubLogin: 'maintainer', avatarUrl: null, identityVerified: true };

function bounty(overrides: Partial<Bounty> = {}): Bounty {
  return {
    id: 'bounty-1',
    ownerUserId: owner.id,
    ownerAddress: '0x0000000000000000000000000000000000000001',
    title: 'Fix the health endpoint',
    description: 'The health endpoint should return HTTP 200.',
    repositoryUrl: 'https://github.com/owlpay/demo',
    rewardAmount: '20',
    reviewPlan: 'STANDARD',
    deadline: future,
    criteria: [],
    status: 'READY_FOR_REVIEW',
    createdAt: past,
    applicantCount: 0,
    reviewPrice: '1',
    reviewPaidAmount: '1',
    reviewPaymentStatus: 'CONSUMED',
    reviewPaymentTxHashes: [],
    reviewPaymentOrderIds: [],
    revisionRequests: [],
    contributorDeadline: future,
    maintainerReviewDeadline: future,
    revisionExtensionUsed: false,
    timeoutResolution: 'NONE',
    onchainId: '7',
    assignedDeveloperUserId: 'developer-1',
    assignedDeveloperAddress: '0x0000000000000000000000000000000000000002',
    submission: {
      pullRequestUrl: 'https://github.com/owlpay/demo/pull/42',
      developerAddress: '0x0000000000000000000000000000000000000002',
      developerUserId: 'developer-1',
      commitSha: 'a'.repeat(40),
      submissionHash: `0x${'c'.repeat(64)}`,
      author: 'developer',
      changedFiles: 1,
      additions: 1,
      deletions: 0,
      submittedAt: past
    },
    decision: {
      decision: 'APPROVE',
      confidence: 0.95,
      summary: 'Every criterion is met.',
      blockingIssues: [],
      criterionResults: [],
      decidedAt: past
    },
    ...overrides
  };
}

function github(pullRequest: Partial<{ merged: boolean }> = {}): GitHubEvidenceProvider {
  return {
    async listManageableRepositories() { return []; },
    async assertCanManageRepository(repositoryUrl) {
      return { id: 1, name: 'demo', fullName: 'owlpay/demo', url: repositoryUrl, ownerLogin: 'owlpay', ownerAvatarUrl: null, permission: 'admin' };
    },
    async getPullRequest(pullRequestUrl) {
      return {
        repositoryUrl: 'https://github.com/owlpay/demo', pullRequestUrl, number: 42, state: 'open', merged: pullRequest.merged ?? false,
        headSha: 'a'.repeat(40), changedFiles: 1, additions: 1, deletions: 0, authorId: 202, author: 'developer', title: 'Work', body: ''
      };
    },
    async reviewPullRequest() {
      return { confidence: 0.95, criterionResults: [], blockingIssues: [] };
    }
  };
}

describe('bounty transitions under concurrent writers', () => {
  it('refuses a maintainer approval that lost the race to the resolution worker', async () => {
    const repository = new InMemoryBountyRepository();
    const stored = bounty();
    await repository.save(stored);

    // The settlement call is the slow step inside approve(). Resolving the
    // bounty here reproduces a worker run that lands while the maintainer's
    // request is still waiting on the chain.
    const settlement: SettlementGateway = {
      writesEnabled: false,
      async approveAndRelease() {
        await repository.save({ ...stored, status: 'REFUNDED', timeoutResolution: 'AUTO_REFUNDED', refundTxHash: `0x${'6'.repeat(64)}` });
        return null;
      },
      async requestRevision() { return null; },
      async approveAfterTimeout() { return null; },
      async refundAfterTimeout() { return null; }
    };
    const service = new BountyService(
      repository,
      new InMemoryApplicationRepository(),
      github(),
      new VerificationPolicy(),
      settlement
    );

    await expect(service.approve(stored.id, owner)).rejects.toMatchObject({
      code: 'BOUNTY_CHANGED',
      statusCode: 409
    });
    // The refund the worker recorded has to survive; a plain save would have
    // replaced it with an approval the maintainer was no longer entitled to.
    expect(await repository.get(stored.id)).toMatchObject({ status: 'REFUNDED', timeoutResolution: 'AUTO_REFUNDED' });
  });

  it('leaves a bounty alone when the maintainer decides mid-resolution', async () => {
    const repository = new InMemoryBountyRepository();
    const stored = bounty({ maintainerReviewDeadline: past });
    await repository.save(stored);

    const evidence = github({ merged: true });
    const racing: GitHubEvidenceProvider = {
      ...evidence,
      async getPullRequest(pullRequestUrl) {
        await repository.save({ ...stored, status: 'PAID', payoutTxHash: `0x${'9'.repeat(64)}` });
        return evidence.getPullRequest(pullRequestUrl);
      }
    };
    const service = new BountyResolutionService(repository, racing, new VerificationPolicy(), {
      writesEnabled: false,
      async approveAndRelease() { return null; },
      async requestRevision() { return null; },
      async approveAfterTimeout() { return null; },
      async refundAfterTimeout() { return null; }
    });

    const report = await service.resolveDueBounties(new Date('2026-08-09T00:00:00.000Z').getTime());

    expect(report.resolved).toHaveLength(0);
    expect(report.failed).toEqual([{ id: stored.id, reason: 'This bounty changed while the request was in flight' }]);
    expect(await repository.get(stored.id)).toMatchObject({ status: 'PAID', timeoutResolution: 'NONE' });
  });

  it('lets only one of two simultaneous refunds through', async () => {
    const repository = new InMemoryBountyRepository();
    const stored = bounty({ status: 'ASSIGNED', contributorDeadline: past, maintainerReviewDeadline: past });
    await repository.save(stored);
    const service = new BountyService(
      repository,
      new InMemoryApplicationRepository(),
      github(),
      new VerificationPolicy()
    );

    const outcomes = await Promise.allSettled([
      service.markRefunded(stored.id, `0x${'1'.repeat(64)}`, owner),
      service.markRefunded(stored.id, `0x${'2'.repeat(64)}`, owner)
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(rejected).toMatchObject({ reason: { code: 'BOUNTY_CHANGED' } });
  });
});
