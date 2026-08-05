'use client';

import type { User } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { clearGitHubProviderToken, getSupabaseBrowserClient, rememberGitHubProviderToken, supabaseConfigured } from '@/lib/supabase';

interface AuthState {
  user: User | null;
  githubLogin: string | null;
  configured: boolean;
  isLoading: boolean;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const oauthReturnKey = 'owlpay.oauth.return-to';

function resumeOAuthReturn(user: User | null) {
  if (!user) return;
  const returnTo = window.sessionStorage.getItem(oauthReturnKey);
  if (!returnTo || !returnTo.startsWith('/app')) return;
  window.sessionStorage.removeItem(oauthReturnKey);
  const current = `${window.location.pathname}${window.location.search}`;
  if (current !== returnTo) window.location.replace(returnTo);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setLoading] = useState(supabaseConfigured);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    client.auth.getSession().then(({ data }) => {
      rememberGitHubProviderToken(data.session?.provider_token);
      setUser(data.session?.user ?? null);
      setLoading(false);
      resumeOAuthReturn(data.session?.user ?? null);
    }).catch(() => setLoading(false));
    const { data } = client.auth.onAuthStateChange((event, session) => {
      rememberGitHubProviderToken(session?.provider_token);
      if (event === 'SIGNED_OUT') clearGitHubProviderToken();
      setUser(session?.user ?? null);
      if (event === 'SIGNED_IN') resumeOAuthReturn(session?.user ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const returnTo = window.location.pathname.startsWith('/app')
      ? `${window.location.pathname}${window.location.search}`
      : '/app';
    window.sessionStorage.setItem(oauthReturnKey, returnTo);
    const { error } = await client.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: `${window.location.origin}/app`, scopes: 'read:user' }
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) throw error;
    clearGitHubProviderToken();
  }, []);

  const metadata = user?.user_metadata as Record<string, unknown> | undefined;
  const githubLogin = typeof metadata?.user_name === 'string'
    ? metadata.user_name
    : typeof metadata?.preferred_username === 'string' ? metadata.preferred_username : null;
  const value = useMemo(() => ({ user, githubLogin, configured: supabaseConfigured, isLoading, signIn, signOut }), [githubLogin, isLoading, signIn, signOut, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
