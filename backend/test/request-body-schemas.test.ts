import { describe, expect, it } from 'vitest';
import {
  walletChallengeSchema,
  walletVerifySchema,
  bountyFundedSchema,
  bountyRefundedSchema,
  bountyAssignSchema,
  reviewPaymentRequestSchema,
  confirmReviewPaymentSchema
} from '../src/domain/schemas.js';

describe('walletChallengeSchema', () => {
  it('accepts a valid EVM address', () => {
    const result = walletChallengeSchema.safeParse({ address: '0x' + 'a'.repeat(40) });
    expect(result.success).toBe(true);
  });

  it('rejects a short address', () => {
    expect(walletChallengeSchema.safeParse({ address: '0xabc' }).success).toBe(false);
  });

  it('rejects missing address', () => {
    expect(walletChallengeSchema.safeParse({}).success).toBe(false);
  });
});

describe('walletVerifySchema', () => {
  it('accepts valid challengeId and signature', () => {
    const result = walletVerifySchema.safeParse({
      challengeId: 'challenge-1',
      signature: '0x' + 'a'.repeat(130)
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty challengeId', () => {
    expect(walletVerifySchema.safeParse({
      challengeId: '',
      signature: '0x' + 'a'.repeat(130)
    }).success).toBe(false);
  });

  it('rejects invalid signature length', () => {
    expect(walletVerifySchema.safeParse({
      challengeId: 'challenge-1',
      signature: '0xabc'
    }).success).toBe(false);
  });

  it('rejects missing fields', () => {
    expect(walletVerifySchema.safeParse({}).success).toBe(false);
  });
});

describe('bountyFundedSchema', () => {
  it('accepts valid onchainId and fundingTxHash', () => {
    const result = bountyFundedSchema.safeParse({
      onchainId: '42',
      fundingTxHash: '0x' + 'b'.repeat(64)
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing onchainId', () => {
    expect(bountyFundedSchema.safeParse({
      fundingTxHash: '0x' + 'b'.repeat(64)
    }).success).toBe(false);
  });

  it('rejects invalid fundingTxHash', () => {
    expect(bountyFundedSchema.safeParse({
      onchainId: '42',
      fundingTxHash: 'not-a-hash'
    }).success).toBe(false);
  });
});

describe('bountyRefundedSchema', () => {
  it('accepts valid refundTxHash', () => {
    const result = bountyRefundedSchema.safeParse({ refundTxHash: '0x' + 'c'.repeat(64) });
    expect(result.success).toBe(true);
  });

  it('rejects invalid refundTxHash', () => {
    expect(bountyRefundedSchema.safeParse({ refundTxHash: 'bad' }).success).toBe(false);
  });
});

describe('bountyAssignSchema', () => {
  it('accepts with optional assignmentTxHash', () => {
    const result = bountyAssignSchema.safeParse({ assignmentTxHash: '0x' + 'd'.repeat(64) });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.assignmentTxHash).toBe('0x' + 'd'.repeat(64));
  });

  it('accepts empty object', () => {
    const result = bountyAssignSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.assignmentTxHash).toBeUndefined();
  });

  it('defaults to empty object for undefined input', () => {
    const result = bountyAssignSchema.safeParse(undefined);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({});
  });

  it('rejects invalid assignmentTxHash', () => {
    expect(bountyAssignSchema.safeParse({ assignmentTxHash: 'bad' }).success).toBe(false);
  });
});

describe('reviewPaymentRequestSchema', () => {
  it('accepts STANDARD plan', () => {
    const result = reviewPaymentRequestSchema.safeParse({ targetPlan: 'STANDARD' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.targetPlan).toBe('STANDARD');
  });

  it('accepts SECURITY plan', () => {
    const result = reviewPaymentRequestSchema.safeParse({ targetPlan: 'SECURITY' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.targetPlan).toBe('SECURITY');
  });

  it('accepts empty object (no target plan)', () => {
    const result = reviewPaymentRequestSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.targetPlan).toBeUndefined();
  });

  it('defaults to empty object for undefined input', () => {
    const result = reviewPaymentRequestSchema.safeParse(undefined);
    expect(result.success).toBe(true);
  });

  it('rejects invalid plan name', () => {
    expect(reviewPaymentRequestSchema.safeParse({ targetPlan: 'GOLD' }).success).toBe(false);
  });
});

describe('confirmReviewPaymentSchema', () => {
  it('accepts valid orderId and txHash', () => {
    const result = confirmReviewPaymentSchema.safeParse({
      orderId: 'flow-order-1',
      txHash: '0x' + 'e'.repeat(64)
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty orderId', () => {
    expect(confirmReviewPaymentSchema.safeParse({
      orderId: '',
      txHash: '0x' + 'e'.repeat(64)
    }).success).toBe(false);
  });

  it('rejects orderId exceeding 200 characters', () => {
    expect(confirmReviewPaymentSchema.safeParse({
      orderId: 'x'.repeat(201),
      txHash: '0x' + 'e'.repeat(64)
    }).success).toBe(false);
  });

  it('rejects missing txHash', () => {
    expect(confirmReviewPaymentSchema.safeParse({
      orderId: 'flow-order-1'
    }).success).toBe(false);
  });

  it('rejects invalid txHash', () => {
    expect(confirmReviewPaymentSchema.safeParse({
      orderId: 'flow-order-1',
      txHash: '0xshort'
    }).success).toBe(false);
  });
});
