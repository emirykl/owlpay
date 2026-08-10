'use client';

import { useCallback, useRef, useState } from 'react';
import { useAuth } from './auth-provider';
import { GitHubMark } from './icons';
import { useClickOutside } from '@/hooks/use-click-outside';

export function AuthButton() {
  const { configured, user, githubLogin, isLoading, signIn, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useClickOutside(menuRef, menuOpen, closeMenu);

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
                } catch {
                  // The session is still live, so leave the menu open for a
                  // retry. Without this the rejection escapes the handler
                  // entirely and surfaces as an unhandled promise rejection.
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
