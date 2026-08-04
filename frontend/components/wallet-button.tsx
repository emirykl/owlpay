'use client';

import { goatTestnet } from '@/lib/network';
import { useWallet } from './wallet-provider';

export function WalletButton() {
  const { address, chainId, connect, disconnect, switchToGoat, isConnecting, error } = useWallet();

  if (address && chainId !== goatTestnet.id) {
    return <button className="walletButton warning" onClick={switchToGoat}>Switch network</button>;
  }

  if (address) {
    return (
      <button className="walletButton connected" onClick={disconnect} title="Disconnect MetaMask">
        <span className="statusDot" />
        {address?.slice(0, 5)}…{address?.slice(-4)}
      </button>
    );
  }

  return (
    <button className="walletButton" disabled={isConnecting} onClick={connect} title={error ?? 'Connect with MetaMask'}>
      {isConnecting ? 'Opening MetaMask…' : error ? 'Try MetaMask again' : 'Connect MetaMask'}
    </button>
  );
}
