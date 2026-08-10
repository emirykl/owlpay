// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { clearGitHubProviderToken, getGitHubProviderToken, rememberGitHubProviderToken } from './supabase';

const storageKey = 'owlpay.github-provider-token';

afterEach(() => window.sessionStorage.clear());

describe('GitHub provider token storage', () => {
  it('round trips a token through session storage', () => {
    rememberGitHubProviderToken('gho_token');

    expect(getGitHubProviderToken()).toBe('gho_token');
    // Session storage, not local storage: the token must not outlive the tab.
    expect(window.sessionStorage.getItem(storageKey)).toBe('gho_token');
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it('ignores an empty token instead of storing a blank entry', () => {
    rememberGitHubProviderToken(null);
    rememberGitHubProviderToken(undefined);
    rememberGitHubProviderToken('');

    expect(getGitHubProviderToken()).toBeNull();
  });

  it('keeps an earlier token when handed nothing', () => {
    rememberGitHubProviderToken('gho_token');

    rememberGitHubProviderToken(null);

    // A session refresh that returns no provider token is not a sign-out, so
    // dropping the stored one here would break repository calls mid-session.
    expect(getGitHubProviderToken()).toBe('gho_token');
  });

  it('clears the token on request', () => {
    rememberGitHubProviderToken('gho_token');

    clearGitHubProviderToken();

    expect(getGitHubProviderToken()).toBeNull();
  });
});
