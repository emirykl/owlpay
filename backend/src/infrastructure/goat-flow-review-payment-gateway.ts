import { GoatFlowClient, GoatFlowError } from 'goatflow-sdk-server';
import type { ReviewPaymentGateway } from '../application/ports.js';
import { DomainError } from '../domain/errors.js';

interface GoatFlowGatewayConfig {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  chainId: number;
  tokenSymbol: string;
  tokenContract: `0x${string}` | '';
}

export class GoatFlowReviewPaymentGateway implements ReviewPaymentGateway {
  readonly configured: boolean;
  private readonly client: GoatFlowClient;

  constructor(private readonly config: GoatFlowGatewayConfig) {
    this.configured = Boolean(config.apiKey && config.apiSecret && config.tokenContract);
    this.client = new GoatFlowClient({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      apiSecret: config.apiSecret
    });
  }

  async createOrder(input: { dappOrderId: string; payer: `0x${string}`; amountWei: string }) {
    this.assertConfigured();
    try {
      const order = await this.client.createOrder({
        dappOrderId: input.dappOrderId,
        chainId: this.config.chainId,
        tokenSymbol: this.config.tokenSymbol,
        tokenContract: this.config.tokenContract,
        fromAddress: input.payer,
        amountWei: input.amountWei
      });
      if (order.flow !== 'ERC20_DIRECT') {
        throw new DomainError('OwlPay currently requires a DIRECT GOAT Flow merchant', 502, 'UNSUPPORTED_GOAT_FLOW');
      }
      return {
        orderId: order.orderId,
        flow: order.flow,
        tokenSymbol: order.tokenSymbol,
        tokenContract: order.tokenContract,
        fromAddress: input.payer,
        payToAddress: order.payToAddress,
        chainId: order.fromChainId,
        amountWei: order.amountWei,
        expiresAt: order.expiresAt,
        ...(order.calldataSignRequest ? { calldataSignRequest: order.calldataSignRequest as unknown as Record<string, unknown> } : {}),
        ...(order.x402 ? { x402: order.x402 as unknown as Record<string, unknown> } : {})
      };
    } catch (error) {
      throw normalizeGoatFlowError(error, 'GOAT Flow could not create the review payment order');
    }
  }

  async getOrderStatus(orderId: string) {
    this.assertConfigured();
    try {
      return await this.client.getOrderStatus(orderId);
    } catch (error) {
      throw normalizeGoatFlowError(error, 'GOAT Flow could not load the payment order');
    }
  }

  async waitForConfirmation(orderId: string) {
    this.assertConfigured();
    try {
      return await this.client.waitForConfirmation(orderId, { timeout: 30_000, interval: 2_000 });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Timeout waiting for order')) {
        throw new DomainError('The transfer is confirmed onchain but GOAT Flow is still processing the order', 409, 'PAYMENT_CONFIRMATION_PENDING');
      }
      throw normalizeGoatFlowError(error, 'GOAT Flow could not confirm the payment order');
    }
  }

  async getOrderProof(orderId: string) {
    this.assertConfigured();
    try {
      return await this.client.getOrderProof(orderId);
    } catch (error) {
      throw normalizeGoatFlowError(error, 'GOAT Flow could not provide the payment proof');
    }
  }

  private assertConfigured() {
    if (!this.configured) {
      throw new DomainError('GOAT Flow merchant payments are not configured', 503, 'REVIEW_PAYMENTS_NOT_CONFIGURED');
    }
  }
}

function normalizeGoatFlowError(error: unknown, message: string) {
  if (error instanceof DomainError) return error;
  if (error instanceof GoatFlowError && (error.status === 401 || error.status === 403)) {
    return new DomainError('GOAT Flow rejected the merchant credentials', 502, 'GOAT_FLOW_AUTH_FAILED');
  }
  if (error instanceof GoatFlowError && error.message.toLowerCase().includes('insufficient fee balance')) {
    return new DomainError('GOAT Flow merchant fee balance is empty; top it up before creating review orders', 503, 'GOAT_FLOW_FEE_BALANCE_REQUIRED');
  }
  if (error instanceof GoatFlowError && error.status === 400) {
    return new DomainError('GOAT Flow rejected the review payment order configuration', 502, 'GOAT_FLOW_ORDER_REJECTED');
  }
  return new DomainError(message, 503, 'GOAT_FLOW_UNAVAILABLE');
}
