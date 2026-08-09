import { describe, expect, it } from 'vitest';
import { BountyService } from '../src/application/bounty-service.js';
import { VerificationPolicy } from '../src/application/verification-policy.js';
import type { AuthUser } from '../src/application/auth.js';
import type { GitHubEvidenceProvider, ReviewPaymentGateway, ReviewPaymentVerifier, SettlementGateway } from '../src/application/ports.js';
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
    return { repositoryUrl: 'https://github.com/owlpay/demo', pullRequestUrl, number: 42, state: 'open', merged: false, headSha: 'a'.repeat(40), changedFiles: 2, additions: 30, deletions: 4, authorId: 202, author: 'developer-two', title: 'Complete bounty', body: 'Implements the requested criteria.' };
  },
  async reviewPullRequest() {
    return { confidence: 0.94, criterionResults: [{ criterionId: 'health', status: 'PASSED' as const, evidence: ['CI passed'], summary: 'Endpoint and tests pass.' }], blockingIssues: [] };
  }
};

const settlement: SettlementGateway = {
  writesEnabled: true,
  async approveAndRelease() { return `0x${'9'.repeat(64)}`; },
  async requestRevision() { return `0x${'8'.repeat(64)}`; },
  async approveAfterTimeout() { return `0x${'7'.repeat(64)}`; },
  async refundAfterTimeout() { return `0x${'6'.repeat(64)}`; }
};

const paymentToken = '0x0000000000000000000000000000000000000010' as const;
const paymentReceiver = '0x0000000000000000000000000000000000000011' as const;

function createPaymentHarness(verifiedAmounts: bigint[] = []) {
  let sequence = 0;
  let lastVerifiedTxHash = `0x${'0'.repeat(64)}`;
  const orders = new Map<string, {
    dappOrderId: string;
    payer: `0x${string}`;
    amountWei: string;
  }>();
  const gateway: ReviewPaymentGateway = {
    configured: true,
    async createOrder(input) {
      const orderId = `flow-order-${++sequence}`;
      orders.set(orderId, input);
      return {
        orderId,
        flow: 'ERC20_DIRECT',
        tokenSymbol: 'USDC',
        tokenContract: paymentToken,
        fromAddress: input.payer,
        payToAddress: paymentReceiver,
        chainId: 48816,
        amountWei: input.amountWei,
        expiresAt: Math.floor(Date.now() / 1_000) + 900,
        x402: { x402Version: 2, order_id: orderId }
      };
    },
    async getOrderStatus(orderId) { return confirmedStatus(orderId); },
    async waitForConfirmation(orderId) { return confirmedStatus(orderId); },
    async getOrderProof(orderId) {
      const order = requireOrder(orderId);
      return {
        payload: {
          order_id: orderId,
          tx_hash: lastVerifiedTxHash,
          log_index: 0,
          from_addr: order.payer,
          to_addr: paymentReceiver,
          amount_wei: order.amountWei,
          from_chain_id: 48816,
          status: 'PAYMENT_CONFIRMED'
        },
        signature: 'test-proof-hash'
      };
    }
  };
  const verifier: ReviewPaymentVerifier = {
    async verify(input) {
      lastVerifiedTxHash = input.txHash;
      verifiedAmounts.push(input.amount);
    }
  };
  return { gateway, verifier };

  function requireOrder(orderId: string) {
    const order = orders.get(orderId);
    if (!order) throw new Error(`Unknown test order ${orderId}`);
    return order;
  }

  function confirmedStatus(orderId: string) {
    const order = requireOrder(orderId);
    return {
      orderId,
      dappOrderId: order.dappOrderId,
      status: 'PAYMENT_CONFIRMED' as const,
      chainId: 48816,
      tokenContract: paymentToken,
      tokenSymbol: 'USDC',
      fromAddress: order.payer,
      amountWei: order.amountWei,
      txHash: lastVerifiedTxHash,
      confirmedAt: new Date().toISOString()
    };
  }
}

const reviewConfig = {
  paymentToken,
  tokenDecimals: 6,
  standardPrice: '2',
  securityPrice: '5'
};

describe('bounty application and assignment flow', () => {
  it('fails closed when a legacy draft has no recorded owner', async () => {
    const repository = new InMemoryBountyRepository();
    const payment = createPaymentHarness();
    const service = new BountyService(
      repository,
      new InMemoryApplicationRepository(),
      github,
      new VerificationPolicy(),
      settlement,
      payment.gateway,
      payment.verifier,
      reviewConfig
    );
    const draft = await service.create({
      title: 'Legacy ownerless bounty',
      description: 'A legacy record must not bypass the funding ownership check.',
      repositoryUrl: 'https://github.com/owlpay/demo',
      ownerAddress: '0x0000000000000000000000000000000000000001',
      rewardAmount: '20',
      reviewPlan: 'NONE',
      deadline: new Date(Date.now() + 86_400_000).toISOString(),
      criteria: [{ id: 'ownership', description: 'Funding remains owner-only', mandatory: true, method: 'manual' }]
    }, owner, 'github-token');
    const { ownerUserId: _legacyOwner, ...ownerlessDraft } = draft;
    await repository.save(ownerlessDraft);

    await expect(service.markFunded(
      draft.id,
      '1',
      `0x${'1'.repeat(64)}`,
      owner.id
    )).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
  });

  it('stores maintainer feedback across a manual revision cycle before approval', async () => {
    const payment = createPaymentHarness();
    const service = new BountyService(
      new InMemoryBountyRepository(),
      new InMemoryApplicationRepository(),
      github,
      new VerificationPolicy(),
      settlement,
      payment.gateway,
      payment.verifier,
      reviewConfig,
      { escrowContractAddress: '0x00000000000000000000000000000000000000aa' }
    );
    const draft = await service.create({
      title: 'Manually review this pull request',
      description: 'The maintainer will inspect and approve the pull request.',
      repositoryUrl: 'https://github.com/owlpay/demo',
      ownerAddress: '0x0000000000000000000000000000000000000001',
      rewardAmount: '20',
      reviewPlan: 'NONE',
      deadline: new Date(Date.now() + 86_400_000).toISOString(),
      criteria: [{ id: 'manual', description: 'Maintainer accepts the implementation', mandatory: true, method: 'manual' }]
    }, owner, 'github-token');

    expect(draft).toMatchObject({
      reviewPlan: 'NONE',
      reviewPrice: '0',
      reviewPaymentStatus: 'NOT_REQUIRED',
      escrowContractAddress: '0x00000000000000000000000000000000000000aa'
    });
    const optionalStandard = await service.createReviewPaymentOrder(draft.id, owner, 'STANDARD');
    expect(optionalStandard.amountWei).toBe('2000000');
    await service.markFunded(draft.id, '7', `0x${'1'.repeat(64)}`, owner.id);
    const application = await service.apply(draft.id, {
      message: 'I can complete this work and provide a focused pull request.',
      developerAddress: '0x0000000000000000000000000000000000000003'
    }, developers[1]!);
    await service.assign(draft.id, application.id, owner);
    const submitted = await service.submit(draft.id, {
      pullRequestUrl: 'https://github.com/owlpay/demo/pull/42',
      developerAddress: application.developerAddress
    }, developers[1]!);

    expect(submitted.bounty.status).toBe('SUBMITTED');
    expect(submitted.bounty.decision).toBeUndefined();
    const revision = await service.requestRevision(draft.id, owner, {
      message: 'Add coverage for the error response and update the API documentation.'
    });
    expect(revision).toMatchObject({
      status: 'REVISION_REQUIRED',
      revisionRequests: [{
        message: 'Add coverage for the error response and update the API documentation.',
        commitSha: 'a'.repeat(40),
        requestedByGithubLogin: 'maintainer'
      }]
    });
    const resubmitted = await service.submit(draft.id, {
      pullRequestUrl: 'https://github.com/owlpay/demo/pull/42',
      developerAddress: application.developerAddress
    }, developers[1]!);
    expect(resubmitted.bounty).toMatchObject({ status: 'SUBMITTED', revisionRequests: revision.revisionRequests });
    expect(await service.approve(draft.id, owner)).toMatchObject({ status: 'PAID', payoutTxHash: `0x${'9'.repeat(64)}` });
  });

  it('upgrades a paid Standard review to Security by charging only the difference', async () => {
    const verifiedAmounts: bigint[] = [];
    const payment = createPaymentHarness(verifiedAmounts);
    const service = new BountyService(
      new InMemoryBountyRepository(),
      new InMemoryApplicationRepository(),
      github,
      new VerificationPolicy(),
      settlement,
      payment.gateway,
      payment.verifier,
      {
        paymentToken: '0x0000000000000000000000000000000000000010',
        tokenDecimals: 6,
        standardPrice: '1',
        securityPrice: '2'
      }
    );
    const draft = await service.create({
      title: 'Upgrade the automated review',
      description: 'Verify that review plan upgrades charge only the difference.',
      repositoryUrl: 'https://github.com/owlpay/demo',
      ownerAddress: '0x0000000000000000000000000000000000000001',
      rewardAmount: '20',
      reviewPlan: 'NONE',
      deadline: new Date(Date.now() + 86_400_000).toISOString(),
      criteria: [{ id: 'upgrade', description: 'Review upgrade is recorded', mandatory: true, method: 'ci' }]
    }, owner, 'github-token');

    const silverOrder = await service.createReviewPaymentOrder(draft.id, owner, 'STANDARD');
    expect(silverOrder.amountWei).toBe('1000000');
    const silver = await service.confirmReviewPayment(draft.id, silverOrder.orderId, `0x${'6'.repeat(64)}`, owner);
    expect(silver).toMatchObject({ reviewPlan: 'STANDARD', reviewPaidAmount: '1', reviewPaymentStatus: 'PAID' });
    const goldOrder = await service.createReviewPaymentOrder(draft.id, owner, 'SECURITY');
    expect(goldOrder.amountWei).toBe('1000000');
    const gold = await service.confirmReviewPayment(draft.id, goldOrder.orderId, `0x${'7'.repeat(64)}`, owner);
    expect(gold).toMatchObject({ reviewPlan: 'SECURITY', reviewPaidAmount: '2', reviewPaymentStatus: 'PAID' });
    expect(gold.reviewPaymentTxHashes).toEqual([`0x${'6'.repeat(64)}`, `0x${'7'.repeat(64)}`]);
    expect(verifiedAmounts).toEqual([1_000_000n, 1_000_000n]);
  });

  it('rejects applications after the bounty deadline', async () => {
    const payment = createPaymentHarness();
    const service = new BountyService(
      new InMemoryBountyRepository(),
      new InMemoryApplicationRepository(),
      github,
      new VerificationPolicy(),
      settlement,
      payment.gateway,
      payment.verifier,
      reviewConfig
    );
    const draft = await service.create({
      title: 'Short deadline bounty',
      description: 'This bounty is used to verify deadline enforcement.',
      repositoryUrl: 'https://github.com/owlpay/demo',
      ownerAddress: '0x0000000000000000000000000000000000000001',
      rewardAmount: '20',
      reviewPlan: 'STANDARD',
      deadline: new Date(Date.now() - 1_000).toISOString(),
      criteria: [{ id: 'deadline', description: 'Deadline enforcement works', mandatory: true, method: 'ci' }]
    }, owner, 'github-token');
    await service.markFunded(draft.id, '1', `0x${'1'.repeat(64)}`, owner.id);

    await expect(service.apply(draft.id, {
      message: 'I would like to complete this bounty before its deadline.',
      developerAddress: '0x0000000000000000000000000000000000000002'
    }, developers[0]!)).rejects.toMatchObject({ code: 'BOUNTY_EXPIRED' });
  });

  it('limits only pending applications and allows more than five accepted bounties', async () => {
    const repository = new InMemoryBountyRepository();
    const applications = new InMemoryApplicationRepository();
    const payment = createPaymentHarness();
    const service = new BountyService(
      repository,
      applications,
      github,
      new VerificationPolicy(),
      settlement,
      payment.gateway,
      payment.verifier,
      reviewConfig
    );
    const bounties = [];

    for (let index = 1; index <= 7; index += 1) {
      const draft = await service.create({
        title: `Pending quota bounty ${index}`,
        description: 'This bounty verifies that only pending applications consume quota.',
        repositoryUrl: 'https://github.com/owlpay/demo',
        ownerAddress: '0x0000000000000000000000000000000000000001',
        rewardAmount: '20',
        reviewPlan: 'NONE',
        deadline: new Date(Date.now() + 86_400_000).toISOString(),
        criteria: [{ id: `quota-${index}`, description: 'Pending quota remains enforced', mandatory: true, method: 'manual' }]
      }, owner, 'github-token');
      await service.markFunded(draft.id, String(index), `0x${String(index).repeat(64)}`, owner.id);
      bounties.push(draft);
    }

    const pending = [];
    for (const bounty of bounties.slice(0, 5)) {
      pending.push(await service.apply(bounty.id, {
        message: 'I can complete this bounty and provide the requested evidence.',
        developerAddress: '0x0000000000000000000000000000000000000002'
      }, developers[0]!));
    }
    await expect(service.apply(bounties[5]!.id, {
      message: 'This sixth pending application must be rejected by the quota.',
      developerAddress: '0x0000000000000000000000000000000000000002'
    }, developers[0]!)).rejects.toMatchObject({ code: 'MAX_PENDING_APPLICATIONS_REACHED' });

    await service.assign(bounties[0]!.id, pending[0]!.id, owner);
    expect(await service.getApplicationSlots(developers[0]!)).toMatchObject({ pending: 4, maxPending: 5, remaining: 1 });
    pending.push(await service.apply(bounties[5]!.id, {
      message: 'An accepted bounty freed one pending application slot for me.',
      developerAddress: '0x0000000000000000000000000000000000000002'
    }, developers[0]!));

    for (let index = 1; index < pending.length; index += 1) {
      await service.assign(bounties[index]!.id, pending[index]!.id, owner);
    }
    const seventh = await service.apply(bounties[6]!.id, {
      message: 'Accepted bounty history has no maximum and does not consume quota.',
      developerAddress: '0x0000000000000000000000000000000000000002'
    }, developers[0]!);
    await service.assign(bounties[6]!.id, seventh.id, owner);

    expect(await service.getApplicationSlots(developers[0]!)).toMatchObject({ pending: 0, maxPending: 5, remaining: 5 });
    expect((await service.listMyApplications(developers[0]!)).filter(({ application }) => application.status === 'ACCEPTED')).toHaveLength(7);
  });

  it('accepts multiple applications, assigns one developer, verifies work, and releases payment after maintainer approval', async () => {
    const payment = createPaymentHarness();
    const service = new BountyService(
      new InMemoryBountyRepository(),
      new InMemoryApplicationRepository(),
      github,
      new VerificationPolicy(),
      settlement,
      payment.gateway,
      payment.verifier,
      reviewConfig
    );
    const draft = await service.create({
      title: 'Add a health endpoint',
      description: 'Return a stable service health response.',
      repositoryUrl: 'https://github.com/owlpay/demo',
      ownerAddress: '0x0000000000000000000000000000000000000001',
      rewardAmount: '20',
      reviewPlan: 'STANDARD',
      deadline: new Date(Date.now() + 86_400_000).toISOString(),
      criteria: [{ id: 'health', description: 'GET /health returns HTTP 200', mandatory: true, method: 'ci' }]
    }, owner, 'github-token');
    await service.markFunded(draft.id, '1', `0x${'1'.repeat(64)}`, owner.id);
    const paymentOrder = await service.createReviewPaymentOrder(draft.id, owner);
    expect(paymentOrder).toMatchObject({
      flow: 'ERC20_DIRECT', chainId: 48816, amountWei: '2000000', payToAddress: paymentReceiver
    });

    const applications = await Promise.all(developers.map((developer, index) => service.apply(draft.id, {
      message: `I can complete this bounty with tests and documentation. Candidate ${index + 1}.`,
      developerAddress: `0x${String(index + 2).padStart(40, '0')}`
    }, developer)));
    expect((await service.get(draft.id)).applicantCount).toBe(3);
    expect(await service.listApplications(draft.id, owner)).toHaveLength(3);

    const assigned = await service.assign(draft.id, applications[1]!.id, owner);
    expect(assigned).toMatchObject({ status: 'ASSIGNED', assignedDeveloperUserId: developers[1]!.id });
    await expect(service.submit(draft.id, { pullRequestUrl: 'https://github.com/owlpay/demo/pull/42', developerAddress: applications[0]!.developerAddress }, developers[0]!)).rejects.toMatchObject({ code: 'DEVELOPER_NOT_ASSIGNED' });

    const submitted = await service.submit(draft.id, { pullRequestUrl: 'https://github.com/owlpay/demo/pull/42', developerAddress: applications[1]!.developerAddress }, developers[1]!);
    expect(submitted.bounty.submission).toMatchObject({ author: 'developer-two', changedFiles: 2, additions: 30, deletions: 4 });
    await expect(service.getSubmissionReportEvidence(draft.id, developers[1]!)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await service.getSubmissionReportEvidence(draft.id, owner)).toEqual({ author: 'developer-two', changedFiles: 2, additions: 30, deletions: 4 });
    await service.confirmReviewPayment(draft.id, paymentOrder.orderId, `0x${'7'.repeat(64)}`, owner);
    expect((await service.get(draft.id)).reviewPaymentStatus).toBe('PAID');
    const reviewed = await service.verify(draft.id, { confidence: 0.94, criterionResults: [{ criterionId: 'health', status: 'PASSED', evidence: ['CI passed'], summary: 'Endpoint and tests pass.' }], blockingIssues: [] });
    expect(reviewed).toMatchObject({ status: 'READY_FOR_REVIEW', decision: { decision: 'APPROVE' } });
    await expect(service.approve(draft.id, developers[1]!)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await service.requestRevision(draft.id, owner, { message: 'Update the pull request with one additional regression test.' });
    const revisedSubmission = await service.submit(draft.id, {
      pullRequestUrl: 'https://github.com/owlpay/demo/pull/42',
      developerAddress: applications[1]!.developerAddress
    }, developers[1]!);
    expect(revisedSubmission.bounty.status).toBe('SUBMITTED');
    expect(revisedSubmission.bounty.decision).toBeUndefined();
    expect(await service.approve(draft.id, owner)).toMatchObject({ status: 'PAID', payoutTxHash: `0x${'9'.repeat(64)}` });
  });

  it('automatically pays a merged submission only after the fixed maintainer window ends', async () => {
    // The pull request is open at submission time and merged by the maintainer
    // afterwards, which is what the timeout resolver later observes.
    let merged = false;
    const mergedGithub: GitHubEvidenceProvider = {
      ...github,
      async getPullRequest(pullRequestUrl) {
        const evidence = await github.getPullRequest(pullRequestUrl);
        return merged ? { ...evidence, merged: true, state: 'closed' } : evidence;
      }
    };
    const service = new BountyService(new InMemoryBountyRepository(), new InMemoryApplicationRepository(), mergedGithub, new VerificationPolicy(), settlement);
    const deadline = new Date(Date.now() + 86_400_000).toISOString();
    const draft = await service.create({
      title: 'Resolve an unanswered review',
      description: 'A merged pull request settles after maintainer inactivity.',
      repositoryUrl: 'https://github.com/owlpay/demo',
      ownerAddress: '0x0000000000000000000000000000000000000001',
      rewardAmount: '20', reviewPlan: 'STANDARD', deadline,
      criteria: [{ id: 'health', description: 'GET /health returns HTTP 200', mandatory: true, method: 'ci' }]
    }, owner, 'github-token');
    await service.markFunded(draft.id, '1', `0x${'1'.repeat(64)}`, owner.id);
    const application = await service.apply(draft.id, {
      message: 'I can complete this bounty with tests and supporting evidence.',
      developerAddress: '0x0000000000000000000000000000000000000003'
    }, developers[1]!);
    await service.assign(draft.id, application.id, owner);
    await service.submit(draft.id, { pullRequestUrl: 'https://github.com/owlpay/demo/pull/42', developerAddress: application.developerAddress }, developers[1]!);

    expect(await service.resolveDueBounties(new Date(deadline).getTime() + 6 * 86_400_000)).toEqual({ resolved: [], failed: [] });
    merged = true;
    await service.resolveDueBounties(new Date(deadline).getTime() + 7 * 86_400_000 + 1);
    expect(await service.get(draft.id)).toMatchObject({ status: 'PAID', timeoutResolution: 'AUTO_APPROVED', payoutTxHash: `0x${'7'.repeat(64)}` });
  });

  it('never releases escrow on an agent report alone when the pull request is not merged', async () => {
    // Regression guard: a pull request diff is attacker-controlled input to the
    // review model, so a glowing report must not be able to move funds by itself.
    const glowingGithub: GitHubEvidenceProvider = {
      ...github,
      async reviewPullRequest() {
        return {
          confidence: 1,
          taskAssessment: { status: 'FULLY_MET' as const, score: 100, evidence: ['file:src/index.ts'], summary: 'Every requested change is implemented.' },
          criterionResults: [{ criterionId: 'health', status: 'PASSED' as const, evidence: ['file:src/index.ts'], summary: 'Endpoint and tests pass.' }],
          blockingIssues: []
        };
      }
    };
    const service = new BountyService(new InMemoryBountyRepository(), new InMemoryApplicationRepository(), glowingGithub, new VerificationPolicy(), settlement);
    const deadline = new Date(Date.now() + 86_400_000).toISOString();
    const draft = await service.create({
      title: 'Refuse an agent-only payout',
      description: 'A perfect agent report still requires a human or a merge to settle.',
      repositoryUrl: 'https://github.com/owlpay/demo',
      ownerAddress: '0x0000000000000000000000000000000000000001',
      rewardAmount: '20', reviewPlan: 'SECURITY', deadline,
      criteria: [{ id: 'health', description: 'GET /health returns HTTP 200', mandatory: true, method: 'ci' }]
    }, owner, 'github-token');
    await service.markFunded(draft.id, '1', `0x${'1'.repeat(64)}`, owner.id);
    const application = await service.apply(draft.id, {
      message: 'I can complete this bounty with tests and supporting evidence.',
      developerAddress: '0x0000000000000000000000000000000000000003'
    }, developers[1]!);
    await service.assign(draft.id, application.id, owner);
    await service.submit(draft.id, { pullRequestUrl: 'https://github.com/owlpay/demo/pull/42', developerAddress: application.developerAddress }, developers[1]!);
    await service.resolveDueBounties(new Date(deadline).getTime() + 7 * 86_400_000 + 1);

    const resolved = await service.get(draft.id);
    expect(resolved).toMatchObject({ status: 'HUMAN_REVIEW', timeoutResolution: 'INCONCLUSIVE' });
    expect(resolved.payoutTxHash).toBeUndefined();
  });

  it('does not lock the maintainer out when an agent review is interrupted', async () => {
    // The review claim marks the bounty VERIFYING before the model call. If the
    // process dies mid-call the claim survives, so it must not become a trap.
    let attempts = 0;
    const flakyGithub: GitHubEvidenceProvider = {
      ...github,
      async reviewPullRequest(...args) {
        attempts += 1;
        if (attempts === 1) throw new Error('OpenAI request timed out');
        return github.reviewPullRequest(...args);
      }
    };
    const repository = new InMemoryBountyRepository();
    const service = new BountyService(repository, new InMemoryApplicationRepository(), flakyGithub, new VerificationPolicy(), settlement);
    const deadline = new Date(Date.now() + 86_400_000).toISOString();
    const draft = await service.create({
      title: 'Survive an interrupted review',
      description: 'A stuck review claim must not block maintainer approval.',
      repositoryUrl: 'https://github.com/owlpay/demo',
      ownerAddress: '0x0000000000000000000000000000000000000001',
      rewardAmount: '20', reviewPlan: 'STANDARD', deadline,
      criteria: [{ id: 'health', description: 'GET /health returns HTTP 200', mandatory: true, method: 'ci' }]
    }, owner, 'github-token');
    await service.markFunded(draft.id, '1', `0x${'1'.repeat(64)}`, owner.id);
    // The review package is already paid for; this test is about the claim, not
    // the purchase, which the payment harness covers elsewhere.
    await repository.save({ ...(await service.get(draft.id)), reviewPaymentStatus: 'PAID', reviewPaidAmount: '1' });
    const application = await service.apply(draft.id, {
      message: 'I can complete this bounty with tests and supporting evidence.',
      developerAddress: '0x0000000000000000000000000000000000000003'
    }, developers[1]!);
    await service.assign(draft.id, application.id, owner);
    await service.submit(draft.id, { pullRequestUrl: 'https://github.com/owlpay/demo/pull/42', developerAddress: application.developerAddress }, developers[1]!);

    await expect(service.runAutomatedReview(draft.id, owner)).rejects.toThrow('OpenAI request timed out');
    // Simulate a process killed mid-review: the claim is left behind uncleaned.
    await repository.save({ ...(await service.get(draft.id)), status: 'VERIFYING' });

    // An unattended retry must not steal a claim that may still be running...
    await expect(service.runPaidReview(draft.id)).rejects.toMatchObject({ code: 'SUBMISSION_REQUIRED' });
    // ...but the maintainer asking for it explicitly takes the claim over.
    expect(await service.runAutomatedReview(draft.id, owner)).toMatchObject({ status: 'READY_FOR_REVIEW' });
    expect(await service.approve(draft.id, owner)).toMatchObject({ status: 'PAID' });
  });

  it('escalates a manual-review bounty instead of substituting an agent verdict', async () => {
    let reviewCalls = 0;
    const countingGithub: GitHubEvidenceProvider = {
      ...github,
      async reviewPullRequest(...args) {
        reviewCalls += 1;
        return github.reviewPullRequest(...args);
      }
    };
    const service = new BountyService(new InMemoryBountyRepository(), new InMemoryApplicationRepository(), countingGithub, new VerificationPolicy(), settlement);
    const deadline = new Date(Date.now() + 86_400_000).toISOString();
    const draft = await service.create({
      title: 'Respect the manual review choice',
      description: 'A maintainer who opted out of agent review keeps that choice on timeout.',
      repositoryUrl: 'https://github.com/owlpay/demo',
      ownerAddress: '0x0000000000000000000000000000000000000001',
      rewardAmount: '20', reviewPlan: 'NONE', deadline,
      criteria: [{ id: 'health', description: 'GET /health returns HTTP 200', mandatory: true, method: 'ci' }]
    }, owner, 'github-token');
    await service.markFunded(draft.id, '1', `0x${'1'.repeat(64)}`, owner.id);
    const application = await service.apply(draft.id, {
      message: 'I can complete this bounty with tests and supporting evidence.',
      developerAddress: '0x0000000000000000000000000000000000000003'
    }, developers[1]!);
    await service.assign(draft.id, application.id, owner);
    await service.submit(draft.id, { pullRequestUrl: 'https://github.com/owlpay/demo/pull/42', developerAddress: application.developerAddress }, developers[1]!);
    await service.resolveDueBounties(new Date(deadline).getTime() + 7 * 86_400_000 + 1);

    expect(reviewCalls).toBe(0);
    expect(await service.get(draft.id)).toMatchObject({ status: 'HUMAN_REVIEW', timeoutResolution: 'INCONCLUSIVE' });
  });

  it('holds a low-confidence timeout decision for appeal instead of refunding immediately', async () => {
    const lowConfidenceGithub: GitHubEvidenceProvider = {
      ...github,
      async reviewPullRequest() {
        return { confidence: 0.4, criterionResults: [{ criterionId: 'health', status: 'UNKNOWN' as const, evidence: [], summary: 'No successful CI run.' }], blockingIssues: [] };
      }
    };
    const service = new BountyService(new InMemoryBountyRepository(), new InMemoryApplicationRepository(), lowConfidenceGithub, new VerificationPolicy(), settlement);
    const deadline = new Date(Date.now() + 86_400_000).toISOString();
    const draft = await service.create({
      title: 'Appeal an uncertain review',
      description: 'Low confidence work remains escrowed during the contributor appeal window.',
      repositoryUrl: 'https://github.com/owlpay/demo',
      ownerAddress: '0x0000000000000000000000000000000000000001',
      rewardAmount: '20', reviewPlan: 'STANDARD', deadline,
      criteria: [{ id: 'health', description: 'GET /health returns HTTP 200', mandatory: true, method: 'ci' }]
    }, owner, 'github-token');
    await service.markFunded(draft.id, '1', `0x${'1'.repeat(64)}`, owner.id);
    const application = await service.apply(draft.id, {
      message: 'I can complete this bounty with tests and supporting evidence.',
      developerAddress: '0x0000000000000000000000000000000000000003'
    }, developers[1]!);
    await service.assign(draft.id, application.id, owner);
    await service.submit(draft.id, { pullRequestUrl: 'https://github.com/owlpay/demo/pull/42', developerAddress: application.developerAddress }, developers[1]!);
    await service.resolveDueBounties(new Date(deadline).getTime() + 7 * 86_400_000 + 1);
    expect(await service.get(draft.id)).toMatchObject({ status: 'HUMAN_REVIEW', timeoutResolution: 'AUTO_FAILED_PENDING' });
    expect(await service.appealTimeoutResolution(draft.id, developers[1]!, 'The CI evidence is now available and should be reviewed again.')).toMatchObject({ timeoutResolution: 'DISPUTED' });
  });
});
