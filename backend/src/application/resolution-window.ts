import type { Bounty, BountyStatus } from '../domain/schemas.js';

/**
 * Statuses a scheduled resolution can still act on. Anything already settled —
 * PAID, REFUNDED, EXPIRED, CANCELLED, APPROVED — is skipped.
 */
export const RESOLVABLE_STATUSES: BountyStatus[] = [
  'OPEN',
  'ASSIGNED',
  'REVISION_REQUIRED',
  'SUBMITTED',
  'VERIFYING',
  'READY_FOR_REVIEW',
  'HUMAN_REVIEW'
];

/**
 * A bounty is worth loading when it is unsettled and at least one of its three
 * clocks has run out. Kept next to the SQL filter it mirrors so the in-memory
 * and Supabase repositories cannot drift apart.
 */
export function isResolvable(bounty: Bounty, now: Date) {
  if (!RESOLVABLE_STATUSES.includes(bounty.status)) return false;
  const elapsed = (value?: string) => Boolean(value) && new Date(value!).getTime() < now.getTime();
  return elapsed(bounty.contributorDeadline)
    || elapsed(bounty.maintainerReviewDeadline)
    || elapsed(bounty.appealDeadline);
}
