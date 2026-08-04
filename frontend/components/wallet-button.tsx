'use client';

import { useEffect, useRef, useState } from 'react';
import { goatTestnet } from '@/lib/network';
import { useWallet } from './wallet-provider';

export function WalletButton() {
  const { address, chainId, connect, disconnect, switchToGoat, isConnecting, error } = useWallet();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  if (address && chainId !== goatTestnet.id) {
    return <button className="walletButton warning" onClick={switchToGoat}>Switch network</button>;
  }

  if (address) {
    return (
      <div className="walletMenu" ref={menuRef}>
        <button
          className="walletButton connected"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <span className="statusDot" />
          {address.slice(0, 5)}…{address.slice(-4)}
        </button>
        {menuOpen && (
          <div className="walletPopover" role="menu">
            <div><span>Connected wallet</span><strong>{address.slice(0, 8)}…{address.slice(-6)}</strong></div>
            <button
              className="disconnectButton"
              role="menuitem"
              onClick={async () => {
                await disconnect();
                setMenuOpen(false);
              }}
            >Disconnect MetaMask</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <button className="walletButton" disabled={isConnecting} onClick={connect} title={error ?? 'Connect with MetaMask'}>
      {isConnecting ? 'Opening MetaMask…' : error ? 'Try MetaMask again' : 'Connect MetaMask'}
    </button>
  );
}
