import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoatFlowReviewPaymentGateway } from '../src/infrastructure/goat-flow-review-payment-gateway.js';

const token = '0x0000000000000000000000000000000000000010' as const;
const payer = '0x0000000000000000000000000000000000000001' as const;
const receiver = '0x0000000000000000000000000000000000000011';

afterEach(() => vi.unstubAllGlobals());

describe('GoatFlowReviewPaymentGateway', () => {
  it('creates a signed merchant order and maps the x402 response for the browser SDK', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('X-API-Key')).toBe('merchant-key');
      expect(headers.get('X-Timestamp')).toMatch(/^\d+$/);
      expect(headers.get('X-Nonce')).toBeTruthy();
      expect(headers.get('X-Sign')).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.parse(String(init?.body))).toEqual({
        dapp_order_id: 'owlpay-intent-1',
        chain_id: 48816,
        token_symbol: 'USDC',
        token_contract: token,
        from_address: payer,
        amount_wei: '1000000'
      });
      return new Response(JSON.stringify({
        x402Version: 2,
        order_id: 'flow-order-1',
        flow: 'ERC20_DIRECT',
        token_symbol: 'USDC',
        resource: { url: '/review' },
        accepts: [{
          scheme: 'exact',
          network: 'eip155:48816',
          amount: '1000000',
          asset: token,
          payTo: receiver,
          maxTimeoutSeconds: 900,
          extra: { flow: 'ERC20_DIRECT', tokenSymbol: 'USDC' }
        }],
        extensions: {
          goatx402: {
            destinationChain: 'eip155:48816',
            expiresAt: Math.floor(Date.now() / 1_000) + 900,
            paymentMethod: 'transfer',
            receiveType: 'DIRECT'
          }
        }
      }), { status: 402, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const gateway = new GoatFlowReviewPaymentGateway({
      baseUrl: 'https://flow.example.test',
      apiKey: 'merchant-key',
      apiSecret: 'merchant-secret',
      chainId: 48816,
      tokenSymbol: 'USDC',
      tokenContract: token
    });
    const order = await gateway.createOrder({ dappOrderId: 'owlpay-intent-1', payer, amountWei: '1000000' });

    expect(order).toMatchObject({
      orderId: 'flow-order-1',
      flow: 'ERC20_DIRECT',
      tokenContract: token,
      fromAddress: payer,
      payToAddress: receiver,
      chainId: 48816,
      amountWei: '1000000'
    });
    expect(order.x402).toMatchObject({ x402Version: 2, order_id: 'flow-order-1' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('reports an empty merchant fee balance without exposing credentials', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'failed to create order: insufficient fee balance: available=$0.000000, required=$0.050000',
      { status: 400 }
    )));
    const gateway = new GoatFlowReviewPaymentGateway({
      baseUrl: 'https://flow.example.test',
      apiKey: 'merchant-key',
      apiSecret: 'merchant-secret',
      chainId: 48816,
      tokenSymbol: 'USDC',
      tokenContract: token
    });

    await expect(gateway.createOrder({ dappOrderId: 'owlpay-intent-2', payer, amountWei: '1000000' }))
      .rejects.toMatchObject({ code: 'GOAT_FLOW_FEE_BALANCE_REQUIRED', statusCode: 503 });
  });
});
