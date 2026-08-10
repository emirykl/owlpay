// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthButton } from './auth-button';

const { authState } = vi.hoisted(() => ({ authState: { current: {} as Record<string, unknown> } }));

vi.mock('./auth-provider', () => ({ useAuth: () => authState.current }));

function auth(overrides: Record<string, unknown> = {}) {
  authState.current = {
    configured: true,
    user: null,
    githubLogin: null,
    isLoading: false,
    signIn: vi.fn(),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
  return authState.current;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => auth());

describe('AuthButton', () => {
  it('says the app is in demo mode when auth is not configured', () => {
    auth({ configured: false });
    render(<AuthButton />);

    expect(screen.getByText('Demo mode')).toBeTruthy();
  });

  it('blocks interaction while the session is still being checked', () => {
    auth({ isLoading: true });
    render(<AuthButton />);

    expect(screen.getByRole('button', { name: /Checking/ }).hasAttribute('disabled')).toBe(true);
  });

  it('starts the GitHub sign-in for a signed-out visitor', () => {
    const state = auth();
    render(<AuthButton />);

    fireEvent.click(screen.getByRole('button', { name: /Connect GitHub/ }));

    expect(state.signIn).toHaveBeenCalledTimes(1);
  });

  it('opens and closes the account menu for a signed-in user', () => {
    auth({ githubLogin: 'maintainer', user: { user_metadata: {} } });
    render(<AuthButton />);

    const trigger = screen.getByRole('button', { name: '@maintainer' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes the menu when the pointer goes down elsewhere', () => {
    auth({ githubLogin: 'maintainer', user: { user_metadata: {} } });
    render(<AuthButton />);
    fireEvent.click(screen.getByRole('button', { name: '@maintainer' }));
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('signs out and dismisses the menu', async () => {
    const state = auth({ githubLogin: 'maintainer', user: { user_metadata: {} } });
    render(<AuthButton />);
    fireEvent.click(screen.getByRole('button', { name: '@maintainer' }));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Disconnect GitHub' }));

    await waitFor(() => expect(state.signOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('leaves the menu open when signing out fails', async () => {
    const state = auth({
      githubLogin: 'maintainer',
      user: { user_metadata: {} },
      signOut: vi.fn().mockRejectedValue(new Error('network down'))
    });
    render(<AuthButton />);
    fireEvent.click(screen.getByRole('button', { name: '@maintainer' }));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Disconnect GitHub' }));

    await waitFor(() => expect(state.signOut).toHaveBeenCalled());
    // The session is still live, so the menu must not pretend otherwise, and
    // the button has to become usable again for a retry.
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Disconnect GitHub' }).hasAttribute('disabled')).toBe(false));
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('shows the GitHub avatar when the profile carries one', () => {
    auth({ githubLogin: 'maintainer', user: { user_metadata: { avatar_url: 'https://avatars.githubusercontent.com/u/1' } } });
    render(<AuthButton />);

    const mark = screen.getByRole('button', { name: '@maintainer' }).querySelector('.providerMark') as HTMLElement;
    expect(mark.style.backgroundImage).toContain('https://avatars.githubusercontent.com/u/1');
  });
});
