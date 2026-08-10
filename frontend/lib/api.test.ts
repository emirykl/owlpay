import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatApiError, owlpayApi } from './api';

const { getSessionMock, getGitHubProviderTokenMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getGitHubProviderTokenMock: vi.fn()
}));

vi.mock('./supabase', () => ({
  getSupabaseBrowserClient: () => ({ auth: { getSession: getSessionMock } }),
  getGitHubProviderToken: getGitHubProviderTokenMock
}));

function respondWith(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body
  })) as unknown as typeof fetch;
}

function lastRequest(fetchMock: typeof fetch) {
  const [path, init] = vi.mocked(fetchMock).mock.calls[0] as [string, RequestInit];
  return { path, init, headers: (init.headers ?? {}) as Record<string, string> };
}

describe('formatApiError', () => {
  it('shows the field and validation detail returned by the API', () => {
    expect(formatApiError({
      message: 'Request validation failed',
      issues: [{ path: ['deadline'], message: 'Deadline must be in the future' }]
    }, 400)).toBe('deadline: Deadline must be in the future');
  });

  it('falls back to the API message when no issue detail exists', () => {
    expect(formatApiError({ message: 'Request failed' }, 400)).toBe('Request failed');
  });

  it('names the status when the API says nothing at all', () => {
    expect(formatApiError({}, 503)).toBe('Request failed (503)');
  });
});

describe('owlpayApi request headers', () => {
  beforeEach(() => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'session-token', provider_token: 'github-token' } } });
    getGitHubProviderTokenMock.mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('carries the session token and keeps the GitHub token off routes that do not need it', async () => {
    const fetchMock = respondWith({ items: [] });
    vi.stubGlobal('fetch', fetchMock);

    await owlpayApi.listBounties();

    const { headers } = lastRequest(fetchMock);
    expect(headers.Authorization).toBe('Bearer session-token');
    // The provider token reaches GitHub on the user's behalf, so it travels only
    // with the calls that actually act on their repositories.
    expect(headers['X-GitHub-Token']).toBeUndefined();
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('adds the GitHub token only for repository-backed calls', async () => {
    const fetchMock = respondWith({ items: [] });
    vi.stubGlobal('fetch', fetchMock);

    await owlpayApi.listManageableRepositories();

    expect(lastRequest(fetchMock).headers['X-GitHub-Token']).toBe('github-token');
  });

  it('falls back to the remembered provider token when the session has none', async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'session-token' } } });
    getGitHubProviderTokenMock.mockReturnValue('remembered-token');
    const fetchMock = respondWith({ items: [] });
    vi.stubGlobal('fetch', fetchMock);

    await owlpayApi.listManageableRepositories();

    expect(lastRequest(fetchMock).headers['X-GitHub-Token']).toBe('remembered-token');
  });

  it('sends no Authorization header when nobody is signed in', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    const fetchMock = respondWith({ items: [] });
    vi.stubGlobal('fetch', fetchMock);

    await owlpayApi.listBounties();

    expect(lastRequest(fetchMock).headers.Authorization).toBeUndefined();
  });

  it('declares a JSON body only when it sends one', async () => {
    const fetchMock = respondWith({ challengeId: 'challenge-1' });
    vi.stubGlobal('fetch', fetchMock);

    await owlpayApi.createWalletChallenge('0x0000000000000000000000000000000000000001');

    const { path, init, headers } = lastRequest(fetchMock);
    expect(path).toContain('/api/wallet/challenge');
    expect(init.method).toBe('POST');
    expect(headers['Content-Type']).toBe('application/json');
  });
});

describe('owlpayApi error handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    getGitHubProviderTokenMock.mockReturnValue(null);
  });

  it('surfaces the validation detail rather than the bare status', async () => {
    vi.stubGlobal('fetch', respondWith(
      { message: 'Request validation failed', issues: [{ path: ['message'], message: 'Tell the maintainer more' }] },
      { ok: false, status: 400 }
    ));

    await expect(owlpayApi.appealResolution('bounty-1', 'too short'))
      .rejects.toThrow('message: Tell the maintainer more');
  });

  it('still reports a failure when the body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => { throw new SyntaxError('Unexpected token <'); }
    })) as unknown as typeof fetch);

    await expect(owlpayApi.listBounties()).rejects.toThrow('Request failed');
  });

  it('treats 402 as the review payment order and anything else as an error', async () => {
    // The x402 flow answers a purchase with Payment Required carrying the order,
    // so a 200 here means the backend did not hand back one to pay.
    vi.stubGlobal('fetch', respondWith({ orderId: 'order-1', amountWei: '1000000' }, { ok: false, status: 402 }));
    await expect(owlpayApi.requestReviewPayment('bounty-1')).resolves.toMatchObject({ orderId: 'order-1' });

    vi.stubGlobal('fetch', respondWith({ message: 'Review already purchased' }, { ok: true, status: 200 }));
    await expect(owlpayApi.requestReviewPayment('bounty-1')).rejects.toThrow('Review already purchased');
  });
});
