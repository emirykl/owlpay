// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewPaymentOrder } from '@/lib/api';
import type { EthereumProvider } from '@/lib/metamask';
import { useWallet, WalletProvider } from './wallet-provider';

const { payMock, getSignerMock } = vi.hoisted(() => ({
  payMock: vi.fn(),
  getSignerMock: vi.fn()
}));

vi.mock('ethers', () => ({
  BrowserProvider: class {
    getSigner = getSignerMock;
  }
}));

vi.mock('goatflow-sdk', () => ({
  PaymentHelper: class {
    pay = payMock;
  }
}));

const address = '0x0000000000000000000000000000000000000001';
const otherWallet = '0x00000000000000000000000000000000000000ff';
const txHash = `0x${'a'.repeat(64)}`;
const goatChainId = 48816;

function order(overrides: Partial<ReviewPaymentOrder> = {}): ReviewPaymentOrder {
  return {
    orderId: 'order-1',
    flow: 'ERC20_DIRECT',
    tokenSymbol: 'USDC',
    tokenContract: '0x1111111111111111111111111111111111111111',
    fromAddress: address,
    payToAddress: '0x2222222222222222222222222222222222222222',
    chainId: goatChainId,
    amountWei: '1000000',
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    ...overrides
  };
}

type PayOrder = (input: ReviewPaymentOrder) => Promise<`0x${string}`>;

let payGoatFlowOrder: PayOrder | null = null;

function PaymentHarness() {
  const wallet = useWallet();
  useEffect(() => {
    payGoatFlowOrder = wallet.payGoatFlowOrder;
  }, [wallet.payGoatFlowOrder]);
  return <span>{wallet.address ?? 'disconnected'}</span>;
}

async function connectedWallet() {
  render(<WalletProvider><PaymentHarness /></WalletProvider>);
  await waitFor(() => {
    expect(screen.getByText(address)).toBeTruthy();
    expect(payGoatFlowOrder).not.toBeNull();
  });
  return payGoatFlowOrder!;
}

describe('GOAT Flow order payment', () => {
  beforeEach(() => {
    payGoatFlowOrder = null;
    payMock.mockReset();
    getSignerMock.mockReset();
    getSignerMock.mockResolvedValue({});
    window.localStorage.clear();
    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      value: {
        isMetaMask: true,
        request: vi.fn(async ({ method }: { method: string }) => {
          if (method === 'eth_accounts') return [address];
          if (method === 'eth_chainId') return '0xbeb0';
          return [];
        })
      } satisfies EthereumProvider
    });
  });

  afterEach(cleanup);

  it('pays a well formed order and returns the settled transaction hash', async () => {
    payMock.mockResolvedValue({ success: true, txHash });
    const pay = await connectedWallet();

    await expect(pay(order())).resolves.toBe(txHash);
    expect(payMock).toHaveBeenCalledTimes(1);
  });

  // Everything below arrives from the payment API, so each guard is what stands
  // between a tampered order and the wallet signing away funds.
  it('refuses an order routed to another network', async () => {
    const pay = await connectedWallet();
    await expect(pay(order({ chainId: 1 }))).rejects.toThrow('unsupported payment network');
    expect(payMock).not.toHaveBeenCalled();
  });

  it('refuses an order billed to a different wallet', async () => {
    const pay = await connectedWallet();
    await expect(pay(order({ fromAddress: otherWallet }))).rejects.toThrow('different wallet');
    expect(payMock).not.toHaveBeenCalled();
  });

  it.each([
    ['recipient', { payToAddress: '0xnot-an-address' }],
    ['token contract', { tokenContract: '0x2222' }]
  ])('refuses an order with a malformed %s', async (_label, overrides) => {
    const pay = await connectedWallet();
    await expect(pay(order(overrides))).rejects.toThrow('invalid payment addresses');
    expect(payMock).not.toHaveBeenCalled();
  });

  it.each([
    ['zero', '0'],
    ['negative', '-1'],
    ['fractional', '1.5'],
    ['empty', '']
  ])('refuses a %s payment amount', async (_label, amountWei) => {
    const pay = await connectedWallet();
    await expect(pay(order({ amountWei }))).rejects.toThrow('invalid payment amount');
    expect(payMock).not.toHaveBeenCalled();
  });

  it('refuses an order whose payment window already closed', async () => {
    const pay = await connectedWallet();
    const expiresAt = Math.floor(Date.now() / 1000) - 1;
    await expect(pay(order({ expiresAt }))).rejects.toThrow('expired');
    expect(payMock).not.toHaveBeenCalled();
  });

  it('reports the reason when the wallet declines the payment', async () => {
    payMock.mockResolvedValue({ success: false, error: 'Insufficient USDC balance.' });
    const pay = await connectedWallet();
    await expect(pay(order())).rejects.toThrow('Insufficient USDC balance.');
  });

  // A receipt that cannot be checked on chain is worse than no receipt, because
  // the confirm call would hand it to the API as proof of payment.
  it('rejects a receipt that is not a usable transaction hash', async () => {
    payMock.mockResolvedValue({ success: true, txHash: 'pending' });
    const pay = await connectedWallet();
    await expect(pay(order())).rejects.toThrow('GOAT Flow payment failed.');
  });
});
