import type { Bounty } from '../domain/schemas.js';

/**
 * Payment bookkeeping only the maintainer who bought the review can act on. The
 * order and proof objects also carry merchant routing details, so they never
 * belong in a listing that anyone can read.
 */
const OWNER_ONLY_PAYMENT_FIELDS = [
  'reviewPaymentOrder',
  'reviewPaymentProof',
  'reviewPaymentPayerAddress',
  'reviewPaymentIntentId',
  'reviewPaymentOrderId',
  'reviewPaymentOrderStatus',
  'reviewPaymentPendingTxHash',
  'reviewPaymentTxHash'
] as const;

/**
 * Narrows a bounty to what this viewer is entitled to see.
 *
 * Account identifiers go only to the account they belong to. They are not
 * credentials, but publishing them hands out a ready made list of accounts to
 * aim at, and the marketplace view has no use for them: the client only ever
 * compares them against the signed in user, and that comparison still answers
 * correctly when the field is absent.
 */
export function bountyForViewer(bounty: Bounty, viewerUserId?: string | null): Bounty {
  if (viewerUserId && bounty.ownerUserId === viewerUserId) return bounty;

  const visible: Bounty = { ...bounty };
  delete visible.decision;
  delete visible.ownerUserId;
  for (const field of OWNER_ONLY_PAYMENT_FIELDS) delete visible[field];
  visible.reviewPaymentOrderIds = [];
  visible.reviewPaymentTxHashes = [];

  // The assigned contributor still needs to recognise their own assignment.
  if (!viewerUserId || bounty.assignedDeveloperUserId !== viewerUserId) {
    delete visible.assignedDeveloperUserId;
  }
  if (visible.submission) {
    const submission = { ...visible.submission };
    delete submission.developerUserId;
    visible.submission = submission;
  }
  return visible;
}
