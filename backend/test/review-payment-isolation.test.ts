import { describe, expect, it } from 'vitest';
import { ReviewPaymentService } from '../src/application/review-payment-service.js';
import { DomainError } from '../src/domain/errors.js';
import type { ReviewConfig } from '../src/application/review-payment-policy.js';
import type { ReviewPaymentGateway, ReviewPaymentVerifier } from '../src/application/ports.js';
import type { AuthUser } from '../src/application/auth.js';
import { InMemoryBountyRepository } from '../src/infrastructure/in-memory-bounty-repository.js';
import type { Bounty } from '../src/domain/schemas.js';

const owner: AuthUser = { id: 'owner-user', githubId: 101, githubLogin: 'maintainer', avatarUrl: null, identityVerified: true };
const ownerAddress = '0x0000000000000000000000000000000000000001';
const payToAddress = '0x0000000000000000000000000000000000000022';
const paymentToken = '0x0000000000000000000000000000000000000010' as const;
const txHash = `0x${'a'.repeat(64)}` as const;
const orderId = 'flow-order-1';
const intentId = 'intent-1';
const future = '2026-08-20T00:00:00.000Z';

const config: ReviewConfig = { paymentToken, tokenDecimals: 6, standardPrice: '1', securityPrice: '2' };

const order = {
  orderId,
  flow: 'ERC20_DIRECT' as const,
  tokenSymbol: 'USDC',
  tokenContract: paymentToken,
  fromAddress: ownerAddress,
  payToAddress,
  chainId: 48816,
  amountWei: '1000000',
  expiresAt: Math.floor(Date.now() / 1_000) + 3_600
};

const confirmation = {
  orderId,
  dappOrderId: intentId,
  status: 'PAYMENT_CONFIRMED' as const,
  chainId: 48816,
  tokenContract: paymentToken,
  tokenSymbol: 'USDC',
  fromAddress: ownerAddress,
  amountWei: '1000000',
  txHash
};

function bounty(overrides: Partial<Bounty> = {}): Bounty {
  return {
    id: 'bounty-1',
    ownerUserId: owner.id,
    ownerAddress,
    title: 'Add a health endpoint',
    description: 'Return a stable service health response.',
    repositoryUrl: 'https://github.com/owlpay/demo',
    rewardAmount: '20',
    reviewPlan: 'STANDARD',
    deadline: future,
    criteria: [],
    status: 'ASSIGNED',
    createdAt: '2026-08-01T00:00:00.000Z',
    applicantCount: 0,
    reviewPrice: '1',
    reviewPaidAmount: '0',
    reviewPaymentStatus: 'REQUIRED',
    reviewPaymentTxHashes: [],
    reviewPaymentOrderIds: [orderId],
    reviewPaymentIntentId: intentId,
    reviewPaymentTargetPlan: 'STANDARD',
    reviewPaymentOrderId: orderId,
    reviewPaymentOrder: order,
    revisionRequests: [],
    contributorDeadline: future,
    maintainerReviewDeadline: future,
    revisionExtensionUsed: false,
    timeoutResolution: 'NONE',
    assignedDeveloperUserId: 'developer-1',
    ...overrides
  };
}

const verifier: ReviewPaymentVerifier = { async verify() {} };

function gateway(onWait?: () => Promise<void>): ReviewPaymentGateway {
  return {
    configured: true,
    async createOrder() { return order; },
    async getOrderStatus() { return confirmation; },
    async waitForConfirmation() {
      // The real gateway is polled here, which is where a submission or an
      // assignment has time to land on the same bounty.
      await onWait?.();
      return confirmation;
    },
    async getOrderProof() {
      return {
        payload: {
          order_id: orderId,
          tx_hash: txHash,
          log_index: 0,
          from_addr: ownerAddress,
          to_addr: payToAddress,
          amount_wei: '1000000',
          from_chain_id: 48816,
          status: 'PAYMENT_CONFIRMED'
        },
        signature: '0xsignature'
      };
    }
  };
}

function setup(onWait?: (repository: InMemoryBountyRepository) => Promise<void>) {
  const repository = new InMemoryBountyRepository();
  const load = async (id: string) => {
    const stored = await repository.get(id);
    if (!stored) throw new DomainError('Bounty not found', 404, 'BOUNTY_NOT_FOUND');
    return stored;
  };
  const service = new ReviewPaymentService(repository, gateway(onWait && (() => onWait(repository))), verifier, config, load);
  return { repository, service };
}

describe('review payment writes stay inside their own columns', () => {
  it('does not erase work submitted while the payment was being confirmed', async () => {
    const stored = bounty();
    const { repository, service } = setup(async (live) => {
      // The contributor delivers while the maintainer's purchase is in flight.
      await live.save({
        ...stored,
        status: 'SUBMITTED',
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
          submittedAt: '2026-08-02T00:00:00.000Z'
        }
      });
    });
    await repository.save(stored);

    const result = await service.confirm(stored.id, orderId, txHash, owner);

    const persisted = await repository.get(stored.id);
    expect(persisted?.status).toBe('SUBMITTED');
    expect(persisted?.submission?.commitSha).toBe('a'.repeat(40));
    expect(persisted?.reviewPaymentStatus).toBe('PAID');
    expect(persisted?.reviewPaymentTxHash).toBe(txHash);
    // The caller is answered with the row as it now stands, not the snapshot
    // the purchase started from.
    expect(result).toMatchObject({ status: 'SUBMITTED', reviewPaymentStatus: 'PAID' });
  });

  it('clears the pending hash it set on the way through', async () => {
    const { repository, service } = setup();
    const stored = bounty();
    await repository.save(stored);

    await service.confirm(stored.id, orderId, txHash, owner);

    const persisted = await repository.get(stored.id);
    expect(persisted?.reviewPaymentPendingTxHash).toBeUndefined();
    expect(persisted?.reviewPaidAt).toBeTruthy();
  });

  it('leaves the bounty untouched when the order is not the active one', async () => {
    const { repository, service } = setup();
    const stored = bounty();
    await repository.save(stored);

    await expect(service.confirm(stored.id, 'another-order', txHash, owner)).rejects.toMatchObject({
      code: 'PAYMENT_ORDER_MISMATCH'
    });
    expect(await repository.get(stored.id)).toMatchObject({ reviewPaymentStatus: 'REQUIRED' });
  });
});
