import { DomainError } from '../domain/errors.js';
import type { Bounty } from '../domain/schemas.js';
import type { BountyRepository } from './ports.js';

/**
 * Commits a lifecycle change only while the bounty still holds the status the
 * caller validated against.
 *
 * Every transition here follows the same shape: read the bounty, check what the
 * actor may do with it, then write the result back. A plain save makes that
 * sequence last-write-wins, so two requests that both passed the check on the
 * same starting state each write a whole row and the second silently erases the
 * first. The realistic pairs are a maintainer approving while the resolution
 * worker settles the same bounty, and two clicks arriving together.
 *
 * Guarding on the starting status turns that into a conflict the caller can see
 * and retry against fresh state. It does not order the on-chain call that some
 * of these transitions make first — the contract rejects a second settlement on
 * its own — it keeps the database from recording a decision that was overtaken.
 */
export async function commitTransition(
  repository: BountyRepository,
  updated: Bounty,
  expectedStatus: Bounty['status']
): Promise<Bounty> {
  const committed = await repository.saveIfStatus(updated, expectedStatus);
  if (!committed) {
    // Worded for both readers of this error: the maintainer whose request lost
    // the race, and the resolution report that records why a bounty was left
    // alone. The next read of either sees the state the winner wrote.
    throw new DomainError('This bounty changed while the request was in flight', 409, 'BOUNTY_CHANGED');
  }
  return updated;
}
