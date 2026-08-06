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
    return { repositoryUrl: 'https://github.com/owlpay/demo', pullRequestUrl, number: 42, state: 'open', headSha: 'a'.repeat(40), changedFiles: 2, additions: 30, deletions: 4, authorId: 202, author: 'developer-two', title: 'Complete bounty' };
  },
  async reviewPullRequest() {
    return { confidence: 0.94, criterionResults: [{ criterionId: 'health', status: 'PASSED' as const, evidence: ['CI passed'], summary: 'Endpoint and tests pass.' }], blockingIssues: [] };
  }
};

const settlement: SettlementGateway = {
  writesEnabled: true,
  async approveAndRelease() { return `0x${'9'.repeat(64)}`; },
  async requestRevision() { return `0x${'8'.repeat(64)}`; }
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
  it('allows a free manual bounty to be approved without an agent payment or report', async () => {
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
      title: 'Manually review this pull request',
      description: 'The maintainer will inspect and approve the pull request.',
      repositoryUrl: 'https://github.com/owlpay/demo',
      ownerAddress: '0x0000000000000000000000000000000000000001',
      rewardAmount: '20',
      reviewPlan: 'NONE',
      deadline: new Date(Date.now() + 86_400_000).toISOString(),
      criteria: [{ id: 'manual', description: 'Maintainer accepts the implementation', mandatory: true, method: 'manual' }]
    }, owner, 'github-token');

    expect(draft).toMatchObject({ reviewPlan: 'NONE', reviewPrice: '0', reviewPaymentStatus: 'NOT_REQUIRED' });
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

    await service.submit(draft.id, { pullRequestUrl: 'https://github.com/owlpay/demo/pull/42', developerAddress: applications[1]!.developerAddress }, developers[1]!);
    await service.confirmReviewPayment(draft.id, paymentOrder.orderId, `0x${'7'.repeat(64)}`, owner);
    expect((await service.get(draft.id)).reviewPaymentStatus).toBe('PAID');
    const reviewed = await service.verify(draft.id, { confidence: 0.94, criterionResults: [{ criterionId: 'health', status: 'PASSED', evidence: ['CI passed'], summary: 'Endpoint and tests pass.' }], blockingIssues: [] });
    expect(reviewed).toMatchObject({ status: 'READY_FOR_REVIEW', decision: { decision: 'APPROVE' } });
    await expect(service.approve(draft.id, developers[1]!)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await service.approve(draft.id, owner)).toMatchObject({ status: 'PAID', payoutTxHash: `0x${'9'.repeat(64)}` });
  });
});
