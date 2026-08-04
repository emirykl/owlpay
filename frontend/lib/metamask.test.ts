import { describe, expect, it, vi } from 'vitest';
import {
  findLegacyMetaMaskProvider,
  isMetaMaskAnnouncement,
  requestMetaMaskAccounts,
  type Eip6963ProviderDetail,
  type EthereumProvider
} from './metamask';

describe('MetaMask provider selection', () => {
  it('selects MetaMask instead of another injected wallet', () => {
    const brave = provider({ isMetaMask: true, isBraveWallet: true });
    const metamask = provider({ isMetaMask: true });
    const injected = provider({ providers: [brave, metamask] });

    expect(findLegacyMetaMaskProvider(injected)).toBe(metamask);
  });

  it('identifies MetaMask EIP-6963 announcements', () => {
    const detail = {
      info: { uuid: 'id', name: 'MetaMask', icon: 'data:image/png;base64,', rdns: 'io.metamask' },
      provider: provider()
    } satisfies Eip6963ProviderDetail;

    expect(isMetaMaskAnnouncement(detail)).toBe(true);
  });

  it('requests explicit account permission before reading the selected account', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'wallet_requestPermissions') return [{ parentCapability: 'eth_accounts' }];
      if (method === 'eth_accounts') return ['0x0000000000000000000000000000000000000001'];
      return [];
    });

    await expect(requestMetaMaskAccounts({ request })).resolves.toEqual(['0x0000000000000000000000000000000000000001']);
    expect(request.mock.calls.map(([input]) => input.method)).toEqual(['wallet_requestPermissions', 'eth_accounts']);
  });

  it('falls back to eth_requestAccounts when permission RPC is unavailable', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'wallet_requestPermissions') throw Object.assign(new Error('Unsupported'), { code: -32601 });
      return ['0x0000000000000000000000000000000000000001'];
    });

    await requestMetaMaskAccounts({ request });
    expect(request.mock.calls.map(([input]) => input.method)).toEqual(['wallet_requestPermissions', 'eth_requestAccounts']);
  });
});

function provider(overrides: Partial<EthereumProvider> = {}): EthereumProvider {
  return { request: vi.fn(async () => []), ...overrides };
}
