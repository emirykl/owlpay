'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { goatTestnet } from '@/lib/network';

interface EthereumProvider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

declare global {
  interface Window { ethereum?: EthereumProvider }
}

interface WalletState {
  address: `0x${string}` | null;
  chainId: number | null;
  isConnecting: boolean;
  error: string | null;
  connect(): Promise<void>;
  disconnect(): void;
  switchToGoat(): Promise<void>;
  sendTransaction(transaction: { to: `0x${string}`; data: `0x${string}` }): Promise<`0x${string}`>;
  signMessage(message: string): Promise<`0x${string}`>;
}

const WalletContext = createContext<WalletState | null>(null);
const chainHex = `0x${goatTestnet.id.toString(16)}`;

function firstAddress(result: unknown): `0x${string}` | null {
  return Array.isArray(result) && typeof result[0] === 'string' && /^0x[a-fA-F0-9]{40}$/.test(result[0])
    ? result[0] as `0x${string}`
    : null;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [isConnecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchToGoat = useCallback(async () => {
    const provider = window.ethereum;
    if (!provider) throw new Error('Install an EVM wallet such as MetaMask.');
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex }] });
    } catch (switchError) {
      if ((switchError as { code?: number }).code !== 4902) throw switchError;
      await provider.request({
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

  const connect = useCallback(async () => {
    const provider = window.ethereum;
    if (!provider) {
      setError('Install an EVM wallet such as MetaMask.');
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      setAddress(firstAddress(accounts));
      const currentChain = await provider.request({ method: 'eth_chainId' });
      const numericChain = typeof currentChain === 'string' ? Number.parseInt(currentChain, 16) : null;
      setChainId(numericChain);
      if (numericChain !== goatTestnet.id) await switchToGoat();
    } catch (connectionError) {
      setError(connectionError instanceof Error ? connectionError.message : 'Wallet connection failed.');
    } finally {
      setConnecting(false);
    }
  }, [switchToGoat]);

  const sendTransaction = useCallback(async (transaction: { to: `0x${string}`; data: `0x${string}` }) => {
    const provider = window.ethereum;
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
  }, [address, chainId, switchToGoat]);

  const signMessage = useCallback(async (message: string) => {
    const provider = window.ethereum;
    if (!provider || !address) throw new Error('Connect your wallet first.');
    const result = await provider.request({ method: 'personal_sign', params: [message, address] });
    if (typeof result !== 'string' || !/^0x[a-fA-F0-9]{130}$/.test(result)) {
      throw new Error('Wallet did not return a valid signature.');
    }
    return result as `0x${string}`;
  }, [address]);

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider) return;
    const accountsChanged = (...args: unknown[]) => setAddress(firstAddress(args[0]));
    const chainChanged = (...args: unknown[]) => setChainId(typeof args[0] === 'string' ? Number.parseInt(args[0], 16) : null);
    provider.request({ method: 'eth_accounts' }).then((accounts) => setAddress(firstAddress(accounts))).catch(() => undefined);
    provider.request({ method: 'eth_chainId' }).then((value) => setChainId(typeof value === 'string' ? Number.parseInt(value, 16) : null)).catch(() => undefined);
    provider.on?.('accountsChanged', accountsChanged);
    provider.on?.('chainChanged', chainChanged);
    return () => {
      provider.removeListener?.('accountsChanged', accountsChanged);
      provider.removeListener?.('chainChanged', chainChanged);
    };
  }, []);

  const value = useMemo<WalletState>(() => ({
    address, chainId, isConnecting, error, connect, switchToGoat, sendTransaction, signMessage,
    disconnect: () => { setAddress(null); setError(null); }
  }), [address, chainId, connect, error, isConnecting, sendTransaction, signMessage, switchToGoat]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error('useWallet must be used inside WalletProvider');
  return value;
}
