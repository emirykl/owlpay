import { describe, expect, it } from 'vitest';
import type { Bounty } from '../src/domain/schemas.js';
import { bountyForViewer } from '../src/application/bounty-visibility.js';

const bounty = {
  ownerUserId: 'maintainer',
  assignedDeveloperUserId: 'contributor',
  assignedDeveloperAddress: '0x0000000000000000000000000000000000000003',
  reviewPaymentStatus: 'PAID',
  reviewPaymentTxHash: `0x${'1'.repeat(64)}`,
  reviewPaymentTxHashes: [`0x${'1'.repeat(64)}`],
  reviewPaymentOrderId: 'flow-order-1',
  reviewPaymentOrderIds: ['flow-order-1'],
  reviewPaymentOrderStatus: 'PAYMENT_CONFIRMED',
  reviewPaymentIntentId: 'intent-1',
  reviewPaymentPayerAddress: '0x0000000000000000000000000000000000000001',
  reviewPaymentOrder: { orderId: 'flow-order-1', payToAddress: '0x0000000000000000000000000000000000000011' },
  reviewPaymentProof: { signature: 'merchant-proof' },
  submission: {
    pullRequestUrl: 'https://github.com/owlpay/demo/pull/42',
    developerAddress: '0x0000000000000000000000000000000000000003',
    developerUserId: 'contributor',
    commitSha: 'a'.repeat(40),
    submissionHash: `0x${'b'.repeat(64)}`,
    submittedAt: new Date().toISOString()
  },
  decision: {
    decision: 'HUMAN_REVIEW',
    confidence: 0.82,
    score: 85,
    summary: 'Maintainer-only Owl AI report.',
    blockingIssues: [],
    criterionResults: [],
    decidedAt: new Date().toISOString()
  }
} as unknown as Bounty;

describe('bountyForViewer', () => {
  it('keeps the Owl AI report for the maintainer', () => {
    expect(bountyForViewer(bounty, 'maintainer').decision?.score).toBe(85);
  });

  it('removes the Owl AI report for contributors and public viewers', () => {
    expect(bountyForViewer(bounty, 'contributor').decision).toBeUndefined();
    expect(bountyForViewer(bounty, null).decision).toBeUndefined();
  });

  it('hands the maintainer their own bounty untouched', () => {
    const owned = bountyForViewer(bounty, 'maintainer');
    expect(owned.ownerUserId).toBe('maintainer');
    expect(owned.reviewPaymentOrder).toBeDefined();
    expect(owned.submission?.developerUserId).toBe('contributor');
  });

  it.each([
    ['a signed out visitor', null],
    ['an unrelated account', 'stranger']
  ])('withholds account identifiers from %s', (_label, viewer) => {
    const visible = bountyForViewer(bounty, viewer);
    expect(visible.ownerUserId).toBeUndefined();
    expect(visible.assignedDeveloperUserId).toBeUndefined();
    expect(visible.submission?.developerUserId).toBeUndefined();
  });

  it('still lets the assigned contributor recognise their own assignment', () => {
    const visible = bountyForViewer(bounty, 'contributor');
    expect(visible.assignedDeveloperUserId).toBe('contributor');
    expect(visible.ownerUserId).toBeUndefined();
  });

  // The merchant order and its proof describe where money is routed, so they
  // stay with the account that paid rather than travelling in a public listing.
  it('withholds review payment bookkeeping from everyone but the payer', () => {
    const visible = bountyForViewer(bounty, 'stranger');
    expect(visible.reviewPaymentOrder).toBeUndefined();
    expect(visible.reviewPaymentProof).toBeUndefined();
    expect(visible.reviewPaymentPayerAddress).toBeUndefined();
    expect(visible.reviewPaymentIntentId).toBeUndefined();
    expect(visible.reviewPaymentOrderId).toBeUndefined();
    expect(visible.reviewPaymentOrderStatus).toBeUndefined();
    expect(visible.reviewPaymentTxHash).toBeUndefined();
    expect(visible.reviewPaymentOrderIds).toEqual([]);
    expect(visible.reviewPaymentTxHashes).toEqual([]);
  });

  // The public view still has to carry everything the marketplace renders.
  it('keeps the details the marketplace actually displays', () => {
    const visible = bountyForViewer(bounty, null);
    expect(visible.reviewPaymentStatus).toBe('PAID');
    expect(visible.assignedDeveloperAddress).toBe('0x0000000000000000000000000000000000000003');
    expect(visible.submission?.pullRequestUrl).toBe('https://github.com/owlpay/demo/pull/42');
  });

  it('leaves the stored bounty untouched', () => {
    bountyForViewer(bounty, null);
    expect(bounty.ownerUserId).toBe('maintainer');
    expect(bounty.submission?.developerUserId).toBe('contributor');
    expect(bounty.reviewPaymentOrderIds).toEqual(['flow-order-1']);
  });
});
