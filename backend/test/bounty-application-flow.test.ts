import { describe, expect, it } from 'vitest';
import { BountyService } from '../src/application/bounty-service.js';
import { VerificationPolicy } from '../src/application/verification-policy.js';
import type { AuthUser } from '../src/application/auth.js';
import type { GitHubEvidenceProvider, SettlementGateway } from '../src/application/ports.js';
import { InMemoryApplicationRepository } from '../src/infrastructure/in-memory-application-repository.js';
import { InMemoryBountyRepository } from '../src/infrastructure/in-memory-bounty-repository.js';

const owner: AuthUser = { id: 'owner-user', githubId: 101, githubLogin: 'maintainer', avatarUrl: null, identityVerified: true };
const developers: AuthUser[] = [
  { id: 'developer-1', githubId: 201, githubLogin: 'developer-one', avatarUrl: null, identityVerified: true },
  { id: 'developer-2', githubId: 202, githubLogin: 'developer-two', avatarUrl: null, identityVerified: true },
  { id: 'developer-3', githubId: 203, githubLogin: 'developer-three', avatarUrl: null, identityVerified: true }
];

const github: GitHubEvidenceProvider = {
  async listManageableRepositories() { return []; },
  async assertCanManageRepository(repositoryUrl) {
    return { id: 1, name: 'demo', fullName: 'owlpay/demo', url: repositoryUrl, ownerLogin: 'owlpay', ownerAvatarUrl: null, permission: 'admin' };
  },
  async getPullRequest(pullRequestUrl) {
    return { repositoryUrl: 'https://github.com/owlpay/demo', pullRequestUrl, number: 42, state: 'open', headSha: 'a'.repeat(40), changedFiles: 2, additions: 30, deletions: 4, authorId: 202, author: 'developer-two', title: 'Complete bounty' };
  }
};

const settlement: SettlementGateway = {
  writesEnabled: true,
  async approveAndRelease() { return `0x${'9'.repeat(64)}`; },
  async requestRevision() { return `0x${'8'.repeat(64)}`; }
};

describe('bounty application and assignment flow', () => {
  it('accepts multiple applications, assigns one developer, verifies work, and releases payment after maintainer approval', async () => {
    const service = new BountyService(new InMemoryBountyRepository(), new InMemoryApplicationRepository(), github, new VerificationPolicy(), settlement);
    const draft = await service.create({
      title: 'Add a health endpoint',
      description: 'Return a stable service health response.',
      repositoryUrl: 'https://github.com/owlpay/demo',
      ownerAddress: '0x0000000000000000000000000000000000000001',
      rewardAmount: '20',
      verificationBudget: '0.5',
      deadline: new Date(Date.now() + 86_400_000).toISOString(),
      criteria: [{ id: 'health', description: 'GET /health returns HTTP 200', mandatory: true, method: 'ci' }]
    }, owner, 'github-token');
    await service.markFunded(draft.id, '1', `0x${'1'.repeat(64)}`, owner.id);

    const applications = await Promise.all(developers.map((developer, index) => service.apply(draft.id, {
      message: `I can complete this bounty with tests and documentation. Candidate ${index + 1}.`,
      developerAddress: `0x${String(index + 2).padStart(40, '0')}`
    }, developer)));
    expect((await service.get(draft.id)).applicantCount).toBe(3);
    expect(await service.listApplications(draft.id, owner)).toHaveLength(3);

    const assigned = await service.assign(draft.id, applications[1]!.id, owner);
    expect(assigned).toMatchObject({ status: 'ASSIGNED', assignedDeveloperUserId: developers[1]!.id });
    await expect(service.submit(draft.id, { pullRequestUrl: 'https://github.com/owlpay/demo/pull/42', developerAddress: applications[0]!.developerAddress }, developers[0]!)).rejects.toMatchObject({ code: 'DEVELOPER_NOT_ASSIGNED' });

    await service.submit(draft.id, { pullRequestUrl: 'https://github.com/owlpay/demo/pull/42', developerAddress: applications[1]!.developerAddress }, developers[1]!);
    const reviewed = await service.verify(draft.id, { confidence: 0.94, criterionResults: [{ criterionId: 'health', status: 'PASSED', evidence: ['CI passed'], summary: 'Endpoint and tests pass.' }], blockingIssues: [] });
    expect(reviewed).toMatchObject({ status: 'READY_FOR_REVIEW', decision: { decision: 'APPROVE' } });
    await expect(service.approve(draft.id, developers[1]!)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await service.approve(draft.id, owner)).toMatchObject({ status: 'PAID', payoutTxHash: `0x${'9'.repeat(64)}` });
  });
});
