import { parseUnits } from 'viem';
import { DomainError } from '../domain/errors.js';
import type { Bounty, BrowserReviewPaymentOrder, ReviewPlan } from '../domain/schemas.js';
import type { ReviewPaymentGateway } from './ports.js';

export interface ReviewConfig {
  paymentToken: `0x${string}` | '';
  tokenDecimals: number;
  standardPrice: string;
  securityPrice: string;
}

export const defaultReviewConfig: ReviewConfig = {
  paymentToken: '',
  tokenDecimals: 6,
  standardPrice: '1',
  securityPrice: '2'
};

export function assertCreatedReviewOrder(
  order: BrowserReviewPaymentOrder,
  payer: string,
  amountWei: string,
  paymentToken: string,
  now = Date.now()
) {
  if (!order.orderId || order.flow !== 'ERC20_DIRECT') {
    throw new DomainError('GOAT Flow returned an unsupported payment order', 502, 'INVALID_GOAT_FLOW_ORDER');
  }
  if (order.chainId !== 48816
    || order.fromAddress.toLowerCase() !== payer.toLowerCase()
    || order.tokenContract.toLowerCase() !== paymentToken.toLowerCase()
    || order.amountWei !== amountWei
    || order.expiresAt * 1_000 <= now
    || !/^0x[a-fA-F0-9]{40}$/.test(order.payToAddress)) {
    throw new DomainError('GOAT Flow returned payment terms that do not match the requested review', 502, 'INVALID_GOAT_FLOW_ORDER');
  }
}

export function assertConfirmedReviewOrder(
  status: Awaited<ReturnType<ReviewPaymentGateway['getOrderStatus']>>,
  bounty: Bounty,
  txHash?: `0x${string}`
) {
  const order = requireActiveOrder(bounty);
  if (status.orderId !== order.orderId
    || status.dappOrderId !== bounty.reviewPaymentIntentId
    || status.chainId !== order.chainId
    || status.fromAddress.toLowerCase() !== order.fromAddress.toLowerCase()
    || status.tokenContract.toLowerCase() !== order.tokenContract.toLowerCase()
    || status.amountWei !== order.amountWei
    || (txHash && status.txHash && status.txHash.toLowerCase() !== txHash.toLowerCase())) {
    throw new DomainError('GOAT Flow order confirmation does not match the original payment terms', 409, 'PAYMENT_ORDER_MISMATCH');
  }
}

export function assertReviewPaymentProof(
  proof: Awaited<ReturnType<ReviewPaymentGateway['getOrderProof']>>,
  bounty: Bounty,
  txHash: `0x${string}`,
  amountWei: string
) {
  const order = requireActiveOrder(bounty);
  const payload = proof.payload;
  if (payload.order_id !== order.orderId
    || payload.tx_hash.toLowerCase() !== txHash.toLowerCase()
    || payload.from_addr.toLowerCase() !== order.fromAddress.toLowerCase()
    || payload.to_addr.toLowerCase() !== order.payToAddress.toLowerCase()
    || payload.amount_wei !== amountWei
    || payload.from_chain_id !== order.chainId
    || !['PAYMENT_CONFIRMED', 'INVOICED'].includes(payload.status)) {
    throw new DomainError('GOAT Flow payment proof does not match the original order', 409, 'PAYMENT_PROOF_MISMATCH');
  }
}

export function calculateReviewUpgrade(
  bounty: Bounty,
  targetPlan: Exclude<ReviewPlan, 'NONE'>,
  config: ReviewConfig
) {
  if (bounty.reviewPaymentStatus === 'CONSUMED') {
    throw new DomainError('The purchased review has already been used', 409, 'REVIEW_ALREADY_CONSUMED');
  }
  const targetPrice = targetPlan === 'SECURITY' ? config.securityPrice : config.standardPrice;
  const targetUnits = parseUnits(targetPrice, config.tokenDecimals);
  const paidUnits = parseUnits(bounty.reviewPaidAmount || '0', config.tokenDecimals);
  if (targetUnits <= paidUnits) {
    throw new DomainError('This review level is already active', 409, 'REVIEW_ALREADY_PAID');
  }
  if (bounty.reviewPlan === 'SECURITY' && paidUnits > 0n && targetPlan === 'STANDARD') {
    throw new DomainError('A Security review cannot be downgraded', 409, 'REVIEW_DOWNGRADE_NOT_ALLOWED');
  }
  return { amount: formatTokenUnits(targetUnits - paidUnits, config.tokenDecimals), targetPrice };
}

function requireActiveOrder(bounty: Bounty) {
  if (!bounty.reviewPaymentOrder) {
    throw new DomainError('This GOAT Flow order is not the active review payment', 409, 'PAYMENT_ORDER_MISMATCH');
  }
  return bounty.reviewPaymentOrder;
}

function formatTokenUnits(units: bigint, decimals: number) {
  if (decimals === 0) return units.toString();
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = units / divisor;
  const fraction = (units % divisor).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
