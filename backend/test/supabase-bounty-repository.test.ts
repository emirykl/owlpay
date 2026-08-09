import { describe, expect, it } from 'vitest';
import type { Bounty } from '../src/domain/schemas.js';
import { SupabaseBountyRepository } from '../src/infrastructure/supabase-bounty-repository.js';
import { createFakeSupabase } from './helpers/fake-supabase.js';

const ownerAddress = `0x${'A'.repeat(40)}`;
const createdAt = '2026-08-01T10:00:00.000Z';

function bounty(overrides: Partial<Bounty> = {}): Bounty {
  return {
    id: 'bounty-1',
    ownerUserId: 'owner-1',
    ownerAddress,
    title: 'Repository adapter test',
    description: 'Round trips every security-sensitive bounty field.',
    repositoryUrl: 'https://github.com/owlpay/demo',
    rewardAmount: '25',
    reviewPlan: 'SECURITY',
    deadline: '2026-08-06T10:00:00.000Z',
    criteria: [{ id: 'tests', description: 'All tests pass', mandatory: true, method: 'ci' }],
    status: 'DRAFT',
    createdAt,
    applicantCount: 0,
    reviewPrice: '5',
    reviewPaidAmount: '0',
    reviewPaymentStatus: 'REQUIRED',
    reviewPaymentTxHashes: [],
    reviewPaymentOrderIds: [],
    revisionRequests: [],
    contributorDeadline: '2026-08-06T10:00:00.000Z',
    maintainerReviewDeadline: '2026-08-13T10:00:00.000Z',
    revisionExtensionUsed: false,
    timeoutResolution: 'NONE',
    ...overrides
  };
}

function setup() {
  const supabase = createFakeSupabase({ bounties: [] });
  return { supabase, repository: new SupabaseBountyRepository(supabase.client) };
}

describe('supabase bounty repository', () => {
  it('round trips a bounty and normalizes persisted wallet addresses', async () => {
    const { repository, supabase } = setup();
    const original = bounty({
      assignedDeveloperAddress: `0x${'B'.repeat(40)}`,
      reviewPaymentPayerAddress: `0x${'C'.repeat(40)}`,
      escrowContractAddress: `0x${'D'.repeat(40)}`
    });

    await repository.save(original);

    expect(supabase.tables.bounties![0]).toMatchObject({
      owner_address: ownerAddress.toLowerCase(),
      assigned_developer_address: `0x${'b'.repeat(40)}`,
      review_payment_payer_address: `0x${'c'.repeat(40)}`,
      escrow_contract_address: `0x${'d'.repeat(40)}`
    });
    expect(await repository.get(original.id)).toMatchObject({
      id: original.id,
      ownerUserId: 'owner-1',
      ownerAddress: ownerAddress.toLowerCase(),
      reviewPlan: 'SECURITY',
      escrowContractAddress: `0x${'d'.repeat(40)}`
    });
  });

  it('lists newest bounties first and honors the requested limit', async () => {
    const { repository } = setup();
    await repository.save(bounty({ id: 'older', createdAt: '2026-08-01T00:00:00.000Z' }));
    await repository.save(bounty({ id: 'newer', createdAt: '2026-08-02T00:00:00.000Z' }));

    await expect(repository.list(1)).resolves.toMatchObject([{ id: 'newer' }]);
  });

  it('detects reused transaction hashes and cross-bounty order ids', async () => {
    const { repository } = setup();
    const txHash = `0x${'A'.repeat(64)}`;
    await repository.save(bounty({
      reviewPaymentTxHash: txHash,
      reviewPaymentTxHashes: [txHash],
      reviewPaymentOrderIds: ['order-1']
    }));

    await expect(repository.findReviewPaymentConflict(txHash.toLowerCase(), 'new-order', 'bounty-2')).resolves.toBe(true);
    await expect(repository.findReviewPaymentConflict(`0x${'b'.repeat(64)}`, 'order-1', 'bounty-2')).resolves.toBe(true);
    await expect(repository.findReviewPaymentConflict(`0x${'b'.repeat(64)}`, 'order-1', 'bounty-1')).resolves.toBe(false);
  });

  it('uses the indexed conflict lookup when migration 0011 is available', async () => {
    const { repository, supabase } = setup();
    supabase.respondToRpc('find_review_payment_conflict', { data: true, error: null });

    await expect(repository.findReviewPaymentConflict(`0x${'a'.repeat(64)}`, 'order-1', 'bounty-2')).resolves.toBe(true);
  });

  it('does not hide indexed lookup database failures', async () => {
    const { repository, supabase } = setup();
    supabase.respondToRpc('find_review_payment_conflict', {
      data: null,
      error: { code: 'XX000', message: 'database unavailable' }
    });

    await expect(repository.findReviewPaymentConflict(`0x${'a'.repeat(64)}`, 'order-1', 'bounty-2'))
      .rejects.toMatchObject({ code: 'DATABASE_ERROR', statusCode: 500 });
  });

  it('performs status writes as a compare-and-set operation', async () => {
    const { repository } = setup();
    const draft = bounty();
    await repository.save(draft);

    await expect(repository.saveIfStatus({ ...draft, status: 'OPEN' }, 'DRAFT')).resolves.toBe(true);
    await expect(repository.saveIfStatus({ ...draft, status: 'CANCELLED' }, 'DRAFT')).resolves.toBe(false);
    await expect(repository.get(draft.id)).resolves.toMatchObject({ status: 'OPEN' });
  });

  it('uses the legacy row shape only for a missing escrow column', async () => {
    const { repository, supabase } = setup();
    supabase.failNext({ message: "Could not find the 'escrow_contract_address' column" }, 'bounties');

    await repository.save(bounty({ escrowContractAddress: `0x${'d'.repeat(40)}` }));

    expect(supabase.tables.bounties![0]).not.toHaveProperty('escrow_contract_address');
  });

  it('turns unique violations into a payment replay conflict', async () => {
    const { repository, supabase } = setup();
    supabase.failNext({ code: '23505', message: 'duplicate key' }, 'bounties');

    await expect(repository.save(bounty())).rejects.toMatchObject({
      code: 'PAYMENT_ALREADY_USED',
      statusCode: 409
    });
  });

  it('wraps database read failures without leaking adapter errors', async () => {
    const { repository, supabase } = setup();
    supabase.failNext({ message: 'connection unavailable' }, 'bounties');

    await expect(repository.get('bounty-1')).rejects.toMatchObject({
      code: 'DATABASE_ERROR',
      statusCode: 500
    });
  });
});
