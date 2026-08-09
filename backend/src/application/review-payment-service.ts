import { randomUUID } from 'node:crypto';
import { parseUnits } from 'viem';
import { DomainError } from '../domain/errors.js';
import type { Bounty, ReviewPlan } from '../domain/schemas.js';
import type { BountyRepository, ReviewPaymentGateway, ReviewPaymentVerifier } from './ports.js';
import type { AuthUser } from './auth.js';
import { assertBountyOwner } from './bounty-ownership.js';
import {
  assertConfirmedReviewOrder,
  assertCreatedReviewOrder,
  assertReviewPaymentProof,
  calculateReviewUpgrade,
  type ReviewConfig
} from './review-payment-policy.js';

/** Order statuses that can no longer lead to a payment. */
const DEAD_ORDER_STATUSES = ['FAILED', 'EXPIRED', 'CANCELLED'];
const SETTLED_ORDER_STATUSES = ['PAYMENT_CONFIRMED', 'INVOICED'];

/**
 * Buys and settles the one Owl Agent review a bounty may carry.
 *
 * Kept apart from the bounty lifecycle because it answers to a different
 * authority: the merchant gateway and the chain decide whether a payment
 * happened, while the lifecycle only ever reads the result.
 */
export class ReviewPaymentService {
  constructor(
    private readonly repository: BountyRepository,
    private readonly gateway: ReviewPaymentGateway,
    private readonly verifier: ReviewPaymentVerifier,
    private readonly config: ReviewConfig,
    private readonly loadBounty: (id: string) => Promise<Bounty>
  ) {}

  async createOrder(id: string, actor: AuthUser, requestedPlan?: ReviewPlan) {
    const bounty = await this.loadBounty(id);
    assertBountyOwner(bounty, actor.id);
    const targetPlan = requirePaidReviewPlan(requestedPlan ?? bounty.reviewPlan);
    this.assertConfigured();
    const payment = calculateReviewUpgrade(bounty, targetPlan, this.config);
    const amountWei = parseUnits(payment.amount, this.config.tokenDecimals).toString();
    const payer = bounty.ownerAddress.toLowerCase();

    const existingOrder = bounty.reviewPaymentOrder;
    const reusableOrder = existingOrder
      && bounty.reviewPaymentOrderId === existingOrder.orderId
      && bounty.reviewPaymentTargetPlan === targetPlan
      && bounty.reviewPaymentPayerAddress?.toLowerCase() === payer
      && existingOrder.amountWei === amountWei
      && existingOrder.expiresAt * 1_000 > Date.now()
      && !DEAD_ORDER_STATUSES.includes(bounty.reviewPaymentOrderStatus ?? 'CHECKOUT_VERIFIED');
    if (reusableOrder) {
      const status = await this.gateway.getOrderStatus(existingOrder.orderId);
      assertConfirmedReviewOrder(status, bounty);
      if (!DEAD_ORDER_STATUSES.includes(status.status)) {
        const clientTxHash = status.txHash ?? bounty.reviewPaymentPendingTxHash;
        const refreshed: Bounty = { ...bounty, reviewPaymentOrderStatus: status.status };
        if (clientTxHash) refreshed.reviewPaymentPendingTxHash = clientTxHash;
        await this.repository.save(refreshed);
        return { ...existingOrder, ...(clientTxHash ? { clientTxHash } : {}) };
      }
    }

    const intentId = randomUUID();
    const pending: Bounty = {
      ...bounty,
      reviewPaymentIntentId: intentId,
      reviewPaymentTargetPlan: targetPlan,
      reviewPaymentPayerAddress: payer,
      reviewPaymentOrderStatus: 'CHECKOUT_VERIFIED'
    };
    delete pending.reviewPaymentOrderId;
    delete pending.reviewPaymentOrder;
    delete pending.reviewPaymentProof;
    delete pending.reviewPaymentPendingTxHash;
    await this.repository.save(pending);

    const order = await this.gateway.createOrder({
      dappOrderId: intentId,
      payer: bounty.ownerAddress as `0x${string}`,
      amountWei
    });
    assertCreatedReviewOrder(order, bounty.ownerAddress, amountWei, this.config.paymentToken);
    const updated: Bounty = {
      ...pending,
      reviewPaymentOrderId: order.orderId,
      reviewPaymentOrderIds: uniqueValues([...bounty.reviewPaymentOrderIds, order.orderId]),
      reviewPaymentOrder: order
    };
    await this.repository.save(updated);
    return order;
  }

  async confirm(id: string, orderId: string, txHash: `0x${string}`, actor: AuthUser) {
    const bounty = await this.loadBounty(id);
    assertBountyOwner(bounty, actor.id);
    if (bounty.reviewPaymentOrderId !== orderId || !bounty.reviewPaymentOrder || !bounty.reviewPaymentIntentId || !bounty.reviewPaymentTargetPlan) {
      throw new DomainError('This GOAT Flow order is not the active review payment', 409, 'PAYMENT_ORDER_MISMATCH');
    }
    // Replaying the same settled transaction is a retry, not a second purchase.
    if (bounty.reviewPaymentTxHashes.some((hash) => hash.toLowerCase() === txHash.toLowerCase())) return bounty;
    this.assertConfigured();

    const targetPlan = bounty.reviewPaymentTargetPlan;
    const payment = calculateReviewUpgrade(bounty, targetPlan, this.config);
    const expectedAmount = parseUnits(payment.amount, this.config.tokenDecimals);
    if (bounty.reviewPaymentOrder.amountWei !== expectedAmount.toString()) {
      throw new DomainError('The review price changed after this order was created', 409, 'PAYMENT_AMOUNT_CHANGED');
    }
    const reused = await this.repository.findReviewPaymentConflict(txHash, orderId, bounty.id);
    if (reused) throw new DomainError('This transaction has already purchased a review', 409, 'PAYMENT_ALREADY_USED');
    await this.verifier.verify({
      txHash,
      payer: bounty.ownerAddress as `0x${string}`,
      token: bounty.reviewPaymentOrder.tokenContract as `0x${string}`,
      payTo: bounty.reviewPaymentOrder.payToAddress as `0x${string}`,
      amount: expectedAmount
    });
    if (bounty.reviewPaymentPendingTxHash?.toLowerCase() !== txHash.toLowerCase()) {
      await this.repository.save({ ...bounty, reviewPaymentPendingTxHash: txHash });
    }

    const status = await this.gateway.waitForConfirmation(orderId);
    assertConfirmedReviewOrder(status, bounty, txHash);
    if (!SETTLED_ORDER_STATUSES.includes(status.status)) {
      await this.repository.save({ ...bounty, reviewPaymentPendingTxHash: txHash, reviewPaymentOrderStatus: status.status });
      throw new DomainError(`GOAT Flow payment ended with status ${status.status}`, 409, 'PAYMENT_NOT_CONFIRMED');
    }
    const proof = await this.gateway.getOrderProof(orderId);
    assertReviewPaymentProof(proof, bounty, txHash, expectedAmount.toString());
    const updated: Bounty = {
      ...bounty,
      reviewPlan: targetPlan,
      reviewPrice: payment.targetPrice,
      reviewPaidAmount: payment.targetPrice,
      reviewPaymentStatus: 'PAID',
      reviewPaymentTxHash: txHash,
      reviewPaymentTxHashes: [...bounty.reviewPaymentTxHashes, txHash],
      reviewPaymentOrderStatus: status.status,
      reviewPaymentProof: proof as unknown as Record<string, unknown>,
      reviewPaidAt: new Date().toISOString()
    };
    delete updated.reviewPaymentPendingTxHash;
    await this.repository.save(updated);
    return updated;
  }

  private assertConfigured() {
    if (!this.config.paymentToken || !this.gateway.configured) {
      throw new DomainError('Review payments are not configured yet', 503, 'REVIEW_PAYMENTS_NOT_CONFIGURED');
    }
  }
}

function requirePaidReviewPlan(plan: ReviewPlan): Exclude<ReviewPlan, 'NONE'> {
  if (plan === 'STANDARD' || plan === 'SECURITY') return plan;
  throw new DomainError('Choose Standard or Security to purchase an Owl Agent review', 400, 'PAID_REVIEW_PLAN_REQUIRED');
}

function uniqueValues(values: string[]) {
  return [...new Set(values)];
}
