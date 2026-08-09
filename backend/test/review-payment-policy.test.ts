import { describe, expect, it } from 'vitest';
import type { ReviewPaymentGateway } from '../src/application/ports.js';
import {
  assertConfirmedReviewOrder,
  assertCreatedReviewOrder,
  assertReviewPaymentProof,
  calculateReviewUpgrade,
  type ReviewConfig
} from '../src/application/review-payment-policy.js';
import type { Bounty, BrowserReviewPaymentOrder } from '../src/domain/schemas.js';

const payer = `0x${'a'.repeat(40)}`;
const token = `0x${'b'.repeat(40)}` as `0x${string}`;
const receiver = `0x${'c'.repeat(40)}`;
const txHash = `0x${'d'.repeat(64)}` as const;
const config: ReviewConfig = { paymentToken: token, tokenDecimals: 6, standardPrice: '2', securityPrice: '5' };

function order(overrides: Partial<BrowserReviewPaymentOrder> = {}): BrowserReviewPaymentOrder {
  return {
    orderId: 'order-1',
    flow: 'ERC20_DIRECT',
    tokenSymbol: 'USDC',
    tokenContract: token,
    fromAddress: payer,
    payToAddress: receiver,
    chainId: 48816,
    amountWei: '2000000',
    expiresAt: 2_000,
    ...overrides
  };
}

function bounty(overrides: Partial<Bounty> = {}): Bounty {
  return {
    id: 'bounty-1',
    ownerUserId: 'owner-1',
    ownerAddress: payer,
    title: 'Payment policy test',
    description: 'Validates review payment terms without infrastructure.',
    repositoryUrl: 'https://github.com/owlpay/demo',
    rewardAmount: '20',
    reviewPlan: 'STANDARD',
    deadline: '2026-08-06T10:00:00.000Z',
    criteria: [{ id: 'payment', description: 'Payment is valid', mandatory: true, method: 'ci' }],
    status: 'DRAFT',
    createdAt: '2026-08-01T10:00:00.000Z',
    applicantCount: 0,
    reviewPrice: '2',
    reviewPaidAmount: '0',
    reviewPaymentStatus: 'REQUIRED',
    reviewPaymentTxHashes: [],
    reviewPaymentIntentId: 'intent-1',
    reviewPaymentOrderId: 'order-1',
    reviewPaymentOrderIds: ['order-1'],
    reviewPaymentOrder: order(),
    revisionRequests: [],
    contributorDeadline: '2026-08-06T10:00:00.000Z',
    maintainerReviewDeadline: '2026-08-13T10:00:00.000Z',
    revisionExtensionUsed: false,
    timeoutResolution: 'NONE',
    ...overrides
  };
}

type OrderStatus = Awaited<ReturnType<ReviewPaymentGateway['getOrderStatus']>>;
function status(overrides: Partial<OrderStatus> = {}): OrderStatus {
  return {
    orderId: 'order-1',
    dappOrderId: 'intent-1',
    status: 'PAYMENT_CONFIRMED',
    chainId: 48816,
    tokenContract: token,
    tokenSymbol: 'USDC',
    fromAddress: payer,
    amountWei: '2000000',
    txHash,
    ...overrides
  };
}

type PaymentProof = Awaited<ReturnType<ReviewPaymentGateway['getOrderProof']>>;
function proof(overrides: Partial<PaymentProof['payload']> = {}): PaymentProof {
  return {
    payload: {
      order_id: 'order-1',
      tx_hash: txHash,
      log_index: 0,
      from_addr: payer,
      to_addr: receiver,
      amount_wei: '2000000',
      from_chain_id: 48816,
      status: 'PAYMENT_CONFIRMED',
      ...overrides
    },
    signature: 'proof-signature'
  };
}

describe('review payment policy', () => {
  it('accepts an exact, unexpired direct-transfer order', () => {
    expect(() => assertCreatedReviewOrder(order(), payer.toUpperCase(), '2000000', token.toUpperCase(), 1_000_000)).not.toThrow();
  });

  it.each([
    ['unsupported flow', { flow: 'ERC20_3009' as const }],
    ['wrong chain', { chainId: 1 }],
    ['wrong payer', { fromAddress: `0x${'1'.repeat(40)}` }],
    ['wrong token', { tokenContract: `0x${'2'.repeat(40)}` }],
    ['wrong amount', { amountWei: '1' }],
    ['expired order', { expiresAt: 999 }],
    ['invalid receiver', { payToAddress: 'not-an-address' }]
  ])('rejects a created order with %s', (_label, overrides) => {
    expect(() => assertCreatedReviewOrder(order(overrides), payer, '2000000', token, 1_000_000))
      .toThrowError(expect.objectContaining({ code: 'INVALID_GOAT_FLOW_ORDER' }));
  });

  it('accepts matching confirmation and proof payloads', () => {
    expect(() => assertConfirmedReviewOrder(status({ txHash: txHash.toUpperCase() as `0x${string}` }), bounty(), txHash)).not.toThrow();
    expect(() => assertReviewPaymentProof(proof({ tx_hash: txHash.toUpperCase() }), bounty(), txHash, '2000000')).not.toThrow();
  });

  it.each([
    ['order id', { orderId: 'other' }],
    ['intent id', { dappOrderId: 'other' }],
    ['chain', { chainId: 1 }],
    ['payer', { fromAddress: `0x${'1'.repeat(40)}` }],
    ['token', { tokenContract: `0x${'2'.repeat(40)}` }],
    ['amount', { amountWei: '1' }],
    ['transaction', { txHash: `0x${'3'.repeat(64)}` }]
  ])('rejects confirmation with a mismatched %s', (_label, overrides) => {
    expect(() => assertConfirmedReviewOrder(status(overrides), bounty(), txHash))
      .toThrowError(expect.objectContaining({ code: 'PAYMENT_ORDER_MISMATCH' }));
  });

  it.each([
    ['order id', { order_id: 'other' }],
    ['transaction', { tx_hash: `0x${'3'.repeat(64)}` }],
    ['payer', { from_addr: `0x${'1'.repeat(40)}` }],
    ['receiver', { to_addr: `0x${'2'.repeat(40)}` }],
    ['amount', { amount_wei: '1' }],
    ['chain', { from_chain_id: 1 }],
    ['status', { status: 'FAILED' }]
  ])('rejects proof with a mismatched %s', (_label, overrides) => {
    expect(() => assertReviewPaymentProof(proof(overrides), bounty(), txHash, '2000000'))
      .toThrowError(expect.objectContaining({ code: 'PAYMENT_PROOF_MISMATCH' }));
  });

  it('charges the exact difference when upgrading a review', () => {
    expect(calculateReviewUpgrade(bounty({ reviewPaidAmount: '2' }), 'SECURITY', config))
      .toEqual({ amount: '3', targetPrice: '5' });
    expect(calculateReviewUpgrade(bounty(), 'STANDARD', { ...config, tokenDecimals: 0, standardPrice: '2' }))
      .toEqual({ amount: '2', targetPrice: '2' });
  });

  it.each([
    ['consumed review', bounty({ reviewPaymentStatus: 'CONSUMED' }), 'SECURITY', 'REVIEW_ALREADY_CONSUMED'],
    ['already paid level', bounty({ reviewPaidAmount: '2' }), 'STANDARD', 'REVIEW_ALREADY_PAID'],
    ['security downgrade', bounty({ reviewPlan: 'SECURITY', reviewPaidAmount: '1' }), 'STANDARD', 'REVIEW_DOWNGRADE_NOT_ALLOWED']
  ] as const)('rejects a %s', (_label, current, target, code) => {
    expect(() => calculateReviewUpgrade(current, target, config))
      .toThrowError(expect.objectContaining({ code }));
  });
});
