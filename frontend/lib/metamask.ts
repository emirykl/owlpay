export interface EthereumProvider {
  isMetaMask?: boolean;
  isBraveWallet?: boolean;
  providers?: EthereumProvider[];
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

export interface Eip6963ProviderDetail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: EthereumProvider;
}

export function isMetaMaskAnnouncement(detail: Eip6963ProviderDetail) {
  return detail.info.rdns === 'io.metamask' || detail.info.rdns.startsWith('io.metamask.');
}

export function findLegacyMetaMaskProvider(injected?: EthereumProvider) {
  if (!injected) return null;
  const candidates = injected.providers?.length ? injected.providers : [injected];
  return candidates.find((provider) => provider.isMetaMask && !provider.isBraveWallet) ?? null;
}

export async function requestMetaMaskAccounts(provider: EthereumProvider) {
  try {
    await provider.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
  } catch (error) {
    if (!isUnsupportedMethod(error)) throw error;
    return provider.request({ method: 'eth_requestAccounts' });
  }

  const accounts = await provider.request({ method: 'eth_accounts' });
  if (Array.isArray(accounts) && accounts.length > 0) return accounts;
  return provider.request({ method: 'eth_requestAccounts' });
}

export async function revokeMetaMaskAccounts(provider: EthereumProvider) {
  try {
    await provider.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] });
  } catch (error) {
    if (!isUnsupportedMethod(error)) throw error;
  }
}

function isUnsupportedMethod(error: unknown) {
  const code = (error as { code?: number } | null)?.code;
  return code === 4200 || code === -32601;
}
