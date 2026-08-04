import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null | undefined;
const githubProviderTokenKey = 'owlpay.github-provider-token';

export function getSupabaseBrowserClient() {
  if (browserClient !== undefined) return browserClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  browserClient = url && publishableKey ? createClient(url, publishableKey) : null;
  return browserClient;
}

export const supabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

export function rememberGitHubProviderToken(token: string | null | undefined) {
  if (typeof window === 'undefined' || !token) return;
  window.sessionStorage.setItem(githubProviderTokenKey, token);
}

export function getGitHubProviderToken() {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(githubProviderTokenKey);
}

export function clearGitHubProviderToken() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(githubProviderTokenKey);
}
