import { DomainError } from '../domain/errors.js';
import type { Bounty } from '../domain/schemas.js';

/**
 * Fails closed on a bounty with no recorded owner. Rows predating owner
 * tracking must be repaired deliberately rather than being treated as
 * ownerless and therefore open to anyone.
 */
export function assertBountyOwner(bounty: Bounty, actorUserId: string) {
  if (!bounty.ownerUserId || bounty.ownerUserId !== actorUserId) {
    throw new DomainError('Only the bounty owner can perform this action', 403, 'FORBIDDEN');
  }
}
