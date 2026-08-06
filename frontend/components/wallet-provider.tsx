'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Eip1193Provider } from 'ethers';
import type { Order as GoatFlowOrder } from 'goatflow-sdk';
import type { ReviewPaymentOrder } from '@/lib/api';
import { goatTestnet } from '@/lib/network';
import {
  findLegacyMetaMaskProvider,
  isMetaMaskAnnouncement,
  requestMetaMaskAccounts,
  revokeMetaMaskAccounts,
  type Eip6963ProviderDetail,
  type EthereumProvider
} from '@/lib/metamask';

declare global {
  interface Window { ethereum?: EthereumProvider }
}

interface WalletState {
  address: `0x${string}` | null;
  chainId: number | null;
  isConnecting: boolean;
  error: string | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  switchToGoat(): Promise<void>;
  sendTransaction(transaction: { to: `0x${string}`; data: `0x${string}` }): Promise<`0x${string}`>;
  payGoatFlowOrder(order: ReviewPaymentOrder): Promise<`0x${string}`>;
  signMessage(message: string): Promise<`0x${string}`>;
}

const WalletContext = createContext<WalletState | null>(null);
const chainHex = `0x${goatTestnet.id.toString(16)}`;
const connectionPreferenceKey = 'owlpay.wallet.connection';

function firstAddress(result: unknown): `0x${string}` | null {
  return Array.isArray(result) && typeof result[0] === 'string' && /^0x[a-fA-F0-9]{40}$/.test(result[0])
    ? result[0] as `0x${string}`
    : null;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [availableProvider, setAvailableProvider] = useState<EthereumProvider | null>(null);
  const [provider, setProvider] = useState<EthereumProvider | null>(null);
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [isConnecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchProviderToGoat = useCallback(async (target: EthereumProvider) => {
    try {
      await target.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex }] });
    } catch (switchError) {
      if ((switchError as { code?: number }).code !== 4902) throw switchError;
      await target.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: chainHex,
          chainName: goatTestnet.name,
          nativeCurrency: goatTestnet.nativeCurrency,
          rpcUrls: [...goatTestnet.rpcUrls.default.http],
          blockExplorerUrls: [goatTestnet.blockExplorers.default.url]
        }]
      });
    }
    setChainId(goatTestnet.id);
  }, []);

  const switchToGoat = useCallback(async () => {
    const target = provider ?? availableProvider ?? findLegacyMetaMaskProvider(window.ethereum);
    if (!target) throw new Error('Install the MetaMask browser extension first.');
    setError(null);
    try {
      await switchProviderToGoat(target);
    } catch (switchError) {
      setError(walletErrorMessage(switchError, 'Network switch failed.'));
      throw switchError;
    }
  }, [availableProvider, provider, switchProviderToGoat]);

  const connect = useCallback(async () => {
    const target = availableProvider ?? findLegacyMetaMaskProvider(window.ethereum);
    if (!target) {
      setError('Install the MetaMask browser extension first.');
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const accounts = await requestMetaMaskAccounts(target);
      const connectedAddress = firstAddress(accounts);
      if (!connectedAddress) throw new Error('MetaMask did not return an account.');
      const currentChain = await target.request({ method: 'eth_chainId' });
      const numericChain = typeof currentChain === 'string' ? Number.parseInt(currentChain, 16) : null;
      setProvider(target);
      setAddress(connectedAddress);
      setChainId(numericChain);
      window.localStorage.setItem(connectionPreferenceKey, 'connected');
      if (numericChain !== goatTestnet.id) await switchProviderToGoat(target);
    } catch (connectionError) {
      setError(walletErrorMessage(connectionError, 'MetaMask connection failed.'));
    } finally {
      setConnecting(false);
    }
  }, [availableProvider, switchProviderToGoat]);

  const sendTransaction = useCallback(async (transaction: { to: `0x${string}`; data: `0x${string}` }) => {
    if (!provider || !address) throw new Error('Connect your wallet first.');
    if (chainId !== goatTestnet.id) await switchToGoat();
    const result = await provider.request({
      method: 'eth_sendTransaction',
      params: [{ from: address, to: transaction.to, data: transaction.data }]
    });
    if (typeof result !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(result)) {
      throw new Error('Wallet did not return a valid transaction hash.');
    }
    return result as `0x${string}`;
  }, [address, chainId, provider, switchToGoat]);

  const signMessage = useCallback(async (message: string) => {
    if (!provider || !address) throw new Error('Connect your wallet first.');
    const result = await provider.request({ method: 'personal_sign', params: [message, address] });
    if (typeof result !== 'string' || !/^0x[a-fA-F0-9]{130}$/.test(result)) {
      throw new Error('Wallet did not return a valid signature.');
    }
    return result as `0x${string}`;
  }, [address, provider]);

  const payGoatFlowOrder = useCallback(async (order: ReviewPaymentOrder) => {
    if (!provider || !address) throw new Error('Connect your wallet first.');
    if (order.chainId !== goatTestnet.id) throw new Error('GOAT Flow returned an unsupported payment network.');
    if (order.fromAddress.toLowerCase() !== address.toLowerCase()) throw new Error('GOAT Flow order belongs to a different wallet.');
    if (!/^0x[a-fA-F0-9]{40}$/.test(order.tokenContract) || !/^0x[a-fA-F0-9]{40}$/.test(order.payToAddress)) {
      throw new Error('GOAT Flow returned invalid payment addresses.');
    }
    if (!/^\d+$/.test(order.amountWei) || BigInt(order.amountWei) <= BigInt(0)) throw new Error('GOAT Flow returned an invalid payment amount.');
    if (order.expiresAt * 1_000 <= Date.now()) throw new Error('The GOAT Flow payment order expired. Please try again.');
    if (chainId !== goatTestnet.id) await switchToGoat();

    const [{ BrowserProvider }, { PaymentHelper }] = await Promise.all([import('ethers'), import('goatflow-sdk')]);
    const browserProvider = new BrowserProvider(provider as Eip1193Provider);
    const signer = await browserProvider.getSigner(address);
    const payment = new PaymentHelper(signer);
    const result = await payment.pay(order as GoatFlowOrder);
    if (!result.success || !result.txHash || !/^0x[a-fA-F0-9]{64}$/.test(result.txHash)) {
      throw new Error(result.error || 'GOAT Flow payment failed.');
    }
    return result.txHash as `0x${string}`;
  }, [address, chainId, provider, switchToGoat]);

  useEffect(() => {
    const announced = (event: Event) => {
      const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
      if (detail && isMetaMaskAnnouncement(detail)) {
        setAvailableProvider((current) => current ?? detail.provider);
        setError(null);
      }
    };
    window.addEventListener('eip6963:announceProvider', announced as EventListener);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    const legacyProvider = findLegacyMetaMaskProvider(window.ethereum);
    const legacyTimer = legacyProvider
      ? window.setTimeout(() => setAvailableProvider((current) => current ?? legacyProvider), 0)
      : null;
    return () => {
      window.removeEventListener('eip6963:announceProvider', announced as EventListener);
      if (legacyTimer !== null) window.clearTimeout(legacyTimer);
    };
  }, []);

  useEffect(() => {
    if (!availableProvider || provider) return;
    if (window.localStorage.getItem(connectionPreferenceKey) === 'disconnected') return;
    let cancelled = false;

    async function restoreConnection() {
      try {
        const accounts = await availableProvider!.request({ method: 'eth_accounts' });
        const connectedAddress = firstAddress(accounts);
        if (!connectedAddress || cancelled) return;
        const currentChain = await availableProvider!.request({ method: 'eth_chainId' });
        if (cancelled) return;
        setProvider(availableProvider);
        setAddress(connectedAddress);
        setChainId(typeof currentChain === 'string' ? Number.parseInt(currentChain, 16) : null);
        setError(null);
        window.localStorage.setItem(connectionPreferenceKey, 'connected');
      } catch {
        // Silent restoration must never interrupt the page or open a wallet prompt.
      }
    }

    void restoreConnection();
    return () => { cancelled = true; };
  }, [availableProvider, provider]);

  useEffect(() => {
    if (!provider) return;
    const accountsChanged = (...args: unknown[]) => setAddress(firstAddress(args[0]));
    const chainChanged = (...args: unknown[]) => setChainId(typeof args[0] === 'string' ? Number.parseInt(args[0], 16) : null);
    provider.on?.('accountsChanged', accountsChanged);
    provider.on?.('chainChanged', chainChanged);
    return () => {
      provider.removeListener?.('accountsChanged', accountsChanged);
      provider.removeListener?.('chainChanged', chainChanged);
    };
  }, [provider]);

  const disconnect = useCallback(async () => {
    const currentProvider = provider;
    window.localStorage.setItem(connectionPreferenceKey, 'disconnected');
    setProvider(null);
    setAddress(null);
    setChainId(null);
    setError(null);
    if (currentProvider) await revokeMetaMaskAccounts(currentProvider).catch(() => undefined);
  }, [provider]);

  const value = useMemo<WalletState>(() => ({
    address, chainId, isConnecting, error, connect, switchToGoat, sendTransaction, payGoatFlowOrder, signMessage,
    disconnect
  }), [address, chainId, connect, disconnect, error, isConnecting, payGoatFlowOrder, sendTransaction, signMessage, switchToGoat]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

function walletErrorMessage(error: unknown, fallback: string) {
  if ((error as { code?: number } | null)?.code === 4001) return 'MetaMask request was rejected.';
  return error instanceof Error && error.message ? error.message : fallback;
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error('useWallet must be used inside WalletProvider');
  return value;
}
