'use client';

import { useAuth } from './auth-provider';

export function AuthButton() {
  const { configured, githubLogin, isLoading, signIn, signOut } = useAuth();
  if (!configured) return <span className="demoPill">Demo mode</span>;
  if (isLoading) return <button className="githubButton" disabled>Checking…</button>;
  if (githubLogin) return <button className="githubButton connected" onClick={signOut}>@{githubLogin}</button>;
  return <button className="githubButton" onClick={signIn}>Connect GitHub</button>;
}

