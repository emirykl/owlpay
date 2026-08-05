'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from './auth-provider';
import { GitHubMark } from './icons';

export function AuthButton() {
  const { configured, user, githubLogin, isLoading, signIn, signOut } = useAuth();
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
  const avatarUrl = typeof user?.user_metadata.avatar_url === 'string' ? user.user_metadata.avatar_url : null;
  if (isLoading) return <button className="githubButton providerButton" disabled><span className="providerMark githubMark"><GitHubMark /></span>Checking…</button>;
  if (githubLogin) {
    return (
      <div className="githubMenu" ref={menuRef}>
        <button
          className="githubButton connected"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <span className="providerMark githubMark" style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}>{!avatarUrl && <GitHubMark />}</span>
          @{githubLogin}
        </button>
        {menuOpen && (
          <div className="githubPopover" role="menu">
            <div className="providerPopoverIdentity"><span className="providerMark githubMark" style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}>{!avatarUrl && <GitHubMark />}</span><p><small>GitHub connected</small><strong>@{githubLogin}</strong></p><i className="statusDot" /></div>
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
  return <button type="button" className="githubButton providerButton" onClick={() => void signIn()}><span className="providerMark githubMark"><GitHubMark /></span>Connect GitHub</button>;
}
