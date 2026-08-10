import { isResolvable } from '../application/resolution-window.js';
import type { BountyRepository } from '../application/ports.js';
import type { Bounty } from '../domain/schemas.js';

/** Mirrors the review payment columns the Supabase adapter writes on its own. */
const REVIEW_PAYMENT_FIELDS = [
  'reviewPlan', 'reviewPrice', 'reviewPaidAmount', 'reviewPaymentStatus', 'reviewPaymentTxHash',
  'reviewPaymentTxHashes', 'reviewPaymentIntentId', 'reviewPaymentOrderId', 'reviewPaymentOrderIds',
  'reviewPaymentTargetPlan', 'reviewPaymentPayerAddress', 'reviewPaymentOrderStatus', 'reviewPaymentOrder',
  'reviewPaymentProof', 'reviewPaymentPendingTxHash', 'reviewPaidAt', 'reviewConsumedAt'
] as const satisfies readonly (keyof Bounty)[];

export class InMemoryBountyRepository implements BountyRepository {
  private readonly bounties = new Map<string, Bounty>();

  async list(limit: number) {
    return [...this.bounties.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async listResolvable(now: Date) {
    return [...this.bounties.values()].filter((bounty) => isResolvable(bounty, now));
  }

  async findReviewPaymentConflict(txHash: string, orderId: string, excludeBountyId: string) {
    const hash = txHash.toLowerCase();
    return [...this.bounties.values()].some((bounty) =>
      bounty.reviewPaymentTxHash?.toLowerCase() === hash
      || bounty.reviewPaymentTxHashes.some((value) => value.toLowerCase() === hash)
      || (bounty.id !== excludeBountyId && bounty.reviewPaymentOrderIds.includes(orderId)));
  }

  async get(id: string) {
    return this.bounties.get(id);
  }

  async save(bounty: Bounty) {
    this.bounties.set(bounty.id, structuredClone(bounty));
  }

  async saveIfStatus(bounty: Bounty, expectedStatus: Bounty['status']) {
    if (this.bounties.get(bounty.id)?.status !== expectedStatus) return false;
    this.bounties.set(bounty.id, structuredClone(bounty));
    return true;
  }

  async saveReviewPayment(bounty: Bounty) {
    const stored = this.bounties.get(bounty.id);
    // An update against a row that is not there changes nothing, the same way
    // the database would report zero rows touched.
    if (!stored) return;

    const merged: Record<string, unknown> = { ...stored };
    for (const field of REVIEW_PAYMENT_FIELDS) {
      // An absent optional field clears its column, so it has to clear here too.
      if (bounty[field] === undefined) delete merged[field];
      else merged[field] = bounty[field];
    }
    this.bounties.set(bounty.id, structuredClone(merged) as unknown as Bounty);
  }
}

