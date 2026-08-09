import { describe, expect, it } from 'vitest';
import { isResolvable, RESOLVABLE_STATUSES } from '../src/application/resolution-window.js';
import type { Bounty, BountyStatus } from '../src/domain/schemas.js';

const now = new Date('2026-08-09T00:00:00.000Z');
const past = '2026-08-08T00:00:00.000Z';
const future = '2026-08-10T00:00:00.000Z';

function bounty(overrides: Partial<Bounty>): Bounty {
  return {
    id: 'bounty-1',
    title: 'Fix the health endpoint',
    description: 'The health endpoint should return HTTP 200.',
    repositoryUrl: 'https://github.com/owlpay/demo',
    ownerAddress: '0x0000000000000000000000000000000000000001',
    rewardAmount: '20',
    reviewPlan: 'STANDARD',
    deadline: future,
    criteria: [],
    status: 'SUBMITTED',
    createdAt: past,
    applicantCount: 0,
    reviewPrice: '1',
    reviewPaidAmount: '0',
    reviewPaymentStatus: 'REQUIRED',
    reviewPaymentTxHashes: [],
    reviewPaymentOrderIds: [],
    revisionRequests: [],
    contributorDeadline: future,
    maintainerReviewDeadline: future,
    revisionExtensionUsed: false,
    timeoutResolution: 'NONE',
    ...overrides
  };
}

describe('resolution window', () => {
  it('skips a bounty whose clocks are all still running', () => {
    expect(isResolvable(bounty({}), now)).toBe(false);
  });

  it.each([
    ['contributorDeadline', { status: 'ASSIGNED' as BountyStatus, contributorDeadline: past }],
    ['maintainerReviewDeadline', { maintainerReviewDeadline: past }],
    ['appealDeadline', { status: 'HUMAN_REVIEW' as BountyStatus, appealDeadline: past }]
  ])('selects a bounty once its %s has elapsed', (_label, overrides) => {
    expect(isResolvable(bounty(overrides), now)).toBe(true);
  });

  it.each(['PAID', 'REFUNDED', 'EXPIRED', 'CANCELLED', 'APPROVED', 'DRAFT'] as BountyStatus[])(
    'never reopens a settled %s bounty',
    (status) => {
      expect(isResolvable(bounty({ status, contributorDeadline: past, maintainerReviewDeadline: past }), now)).toBe(false);
    }
  );

  it('covers every status the resolver acts on', () => {
    // Guards against a status being handled in resolveDueBounty but dropped from
    // the database filter, which would silently stop resolving those bounties.
    expect(RESOLVABLE_STATUSES).toEqual([
      'OPEN', 'ASSIGNED', 'REVISION_REQUIRED', 'SUBMITTED', 'VERIFYING', 'READY_FOR_REVIEW', 'HUMAN_REVIEW'
    ]);
  });
});
