import { isResolvable } from '../application/resolution-window.js';
import type { BountyRepository } from '../application/ports.js';
import type { Bounty } from '../domain/schemas.js';

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
}

