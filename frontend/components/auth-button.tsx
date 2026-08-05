'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from './auth-provider';

export function AuthButton() {
  const { configured, githubLogin, isLoading, signIn, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
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

  if (!configured) return <span className="demoPill">Demo mode</span>;
  if (isLoading) return <button className="githubButton" disabled>Checking…</button>;
  if (githubLogin) {
    return (
      <div className="githubMenu" ref={menuRef}>
        <button
          className="githubButton connected"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          @{githubLogin}
        </button>
        {menuOpen && (
          <div className="githubPopover" role="menu">
            <div><span>Connected GitHub</span><strong>@{githubLogin}</strong></div>
            <button
              className="disconnectButton"
              role="menuitem"
              disabled={isSigningOut}
              onClick={async () => {
                setIsSigningOut(true);
                try {
                  await signOut();
                  setMenuOpen(false);
                } finally {
                  setIsSigningOut(false);
                }
              }}
            >
              {isSigningOut ? 'Disconnecting…' : 'Disconnect GitHub'}
            </button>
          </div>
        )}
      </div>
    );
  }
  return <button className="githubButton" onClick={signIn}>Connect GitHub</button>;
}
