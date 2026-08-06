// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EthereumProvider } from '@/lib/metamask';
import { useWallet, WalletProvider } from './wallet-provider';

const address = '0x0000000000000000000000000000000000000001';

describe('WalletProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('silently restores an already-authorized MetaMask account after a reload', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_accounts') return [address];
      if (method === 'eth_chainId') return '0xbeb0';
      return [];
    });
    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      value: { isMetaMask: true, request } satisfies EthereumProvider
    });

    render(<WalletProvider><WalletAddress /></WalletProvider>);

    await waitFor(() => expect(screen.getByText(address)).toBeTruthy());
    expect(request.mock.calls.map(([input]) => input.method)).toEqual(['eth_accounts', 'eth_chainId']);
    expect(window.localStorage.getItem('owlpay.wallet.connection')).toBe('connected');
  });
});

function WalletAddress() {
  const { address: connectedAddress } = useWallet();
  return <span>{connectedAddress ?? 'disconnected'}</span>;
}
