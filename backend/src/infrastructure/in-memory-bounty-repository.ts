import type { BountyRepository } from '../application/ports.js';
import type { Bounty } from '../domain/schemas.js';

export class InMemoryBountyRepository implements BountyRepository {
  private readonly bounties = new Map<string, Bounty>();

  async list() {
    return [...this.bounties.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string) {
    return this.bounties.get(id);
  }

  async save(bounty: Bounty) {
    this.bounties.set(bounty.id, structuredClone(bounty));
  }
}

