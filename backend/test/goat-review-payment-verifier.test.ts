import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from 'viem';

const getTransactionReceipt = vi.fn();
const getTransaction = vi.fn();

vi.mock('../src/infrastructure/goat-client.js', () => ({
  goatPublicClient: {
    getTransactionReceipt: (...args: unknown[]) => getTransactionReceipt(...args),
    getTransaction: (...args: unknown[]) => getTransaction(...args)
  }
}));

const { GoatReviewPaymentVerifier } = await import('../src/infrastructure/goat-review-payment-verifier.js');

const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const payer = `0x${'a'.repeat(40)}` as const;
const payTo = `0x${'b'.repeat(40)}` as const;
const token = `0x${'c'.repeat(40)}` as const;
const txHash = `0x${'d'.repeat(64)}` as const;
const amount = 1_000_000n;

function transferLog(overrides: { address?: string; from?: string; to?: string; value?: bigint } = {}) {
  return {
    address: overrides.address ?? token,
    topics: encodeEventTopics({
      abi: [transferEvent],
      eventName: 'Transfer',
      args: { from: (overrides.from ?? payer) as `0x${string}`, to: (overrides.to ?? payTo) as `0x${string}` }
    }),
    data: encodeAbiParameters([{ type: 'uint256' }], [overrides.value ?? amount])
  };
}

function payment() {
  return { txHash, payer, token, payTo, amount };
}

describe('goat review payment verifier', () => {
  const verifier = new GoatReviewPaymentVerifier();

  beforeEach(() => {
    getTransactionReceipt.mockReset();
    getTransaction.mockReset();
    getTransactionReceipt.mockResolvedValue({ status: 'success', logs: [transferLog()] });
    getTransaction.mockResolvedValue({ from: payer });
  });

  it('accepts a settled transfer that matches the order exactly', async () => {
    await expect(verifier.verify(payment())).resolves.toBeUndefined();
  });

  it('accepts a matching transfer among unrelated logs', async () => {
    getTransactionReceipt.mockResolvedValue({
      status: 'success',
      logs: [transferLog({ address: `0x${'e'.repeat(40)}` }), transferLog()]
    });
    await expect(verifier.verify(payment())).resolves.toBeUndefined();
  });

  it('rejects a transaction that is not on chain', async () => {
    getTransactionReceipt.mockRejectedValue(new Error('not found'));
    await expect(verifier.verify(payment())).rejects.toMatchObject({ code: 'PAYMENT_NOT_FOUND' });
  });

  it('rejects a reverted transaction', async () => {
    getTransactionReceipt.mockResolvedValue({ status: 'reverted', logs: [transferLog()] });
    await expect(verifier.verify(payment())).rejects.toMatchObject({ code: 'PAYMENT_FAILED' });
  });

  it('rejects payment sent from a wallet other than the bounty owner', async () => {
    getTransaction.mockResolvedValue({ from: `0x${'9'.repeat(40)}` });
    await expect(verifier.verify(payment())).rejects.toMatchObject({ code: 'PAYMENT_PAYER_MISMATCH', statusCode: 403 });
  });

  it('rejects a transfer emitted by a different token contract', async () => {
    // Without this check any token could be used to fake a stablecoin payment.
    getTransactionReceipt.mockResolvedValue({ status: 'success', logs: [transferLog({ address: `0x${'e'.repeat(40)}` })] });
    await expect(verifier.verify(payment())).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' });
  });

  it('rejects a transfer to a different recipient', async () => {
    getTransactionReceipt.mockResolvedValue({ status: 'success', logs: [transferLog({ to: `0x${'9'.repeat(40)}` })] });
    await expect(verifier.verify(payment())).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' });
  });

  it('rejects an underpayment', async () => {
    getTransactionReceipt.mockResolvedValue({ status: 'success', logs: [transferLog({ value: amount - 1n })] });
    await expect(verifier.verify(payment())).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' });
  });

  it('ignores logs that are not decodable Transfer events', async () => {
    getTransactionReceipt.mockResolvedValue({
      status: 'success',
      logs: [{ address: token, topics: [`0x${'1'.repeat(64)}`], data: '0x' }]
    });
    await expect(verifier.verify(payment())).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' });
  });
});
