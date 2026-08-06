import { describe, expect, it } from 'vitest';
import { createBountySchema } from '../src/domain/schemas.js';

function payload(deadline: string) {
  return {
    title: 'Bounded bounty deadline',
    description: 'Verify the minimum and maximum deadline rules.',
    repositoryUrl: 'https://github.com/owlpay/demo',
    ownerAddress: '0x0000000000000000000000000000000000000001',
    rewardAmount: '20',
    reviewPlan: 'STANDARD',
    deadline,
    criteria: [{ id: 'deadline', description: 'Deadline is valid', mandatory: true, method: 'ci' }]
  };
}

describe('createBountySchema deadline', () => {
  it('accepts free manual review while keeping standard review as the default', () => {
    const manual = createBountySchema.safeParse({
      ...payload(new Date(Date.now() + 24 * 3_600_000).toISOString()),
      reviewPlan: 'NONE'
    });
    const defaultPlan = createBountySchema.parse({
      ...payload(new Date(Date.now() + 24 * 3_600_000).toISOString()),
      reviewPlan: undefined
    });

    expect(manual.success).toBe(true);
    expect(defaultPlan.reviewPlan).toBe('STANDARD');
  });

  it('rejects a deadline shorter than 1 hour', () => {
    const result = createBountySchema.safeParse(payload(new Date(Date.now() + 30 * 60_000).toISOString()));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe('Deadline must be at least 1 hour from now');
  });

  it('rejects a deadline longer than 7 days', () => {
    const result = createBountySchema.safeParse(payload(new Date(Date.now() + 8 * 24 * 3_600_000).toISOString()));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe('Deadline must be within the next 7 days');
  });
});
