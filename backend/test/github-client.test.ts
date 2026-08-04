import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubClient } from '../src/infrastructure/github-client.js';

afterEach(() => vi.restoreAllMocks());

describe('GitHub repository authorization', () => {
  it('returns only public, active repositories with write access', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ id: 42, login: 'owl-owner' }))
      .mockResolvedValueOnce(jsonResponse([
        repository({ id: 1, full_name: 'owl-owner/owlpay', permissions: { admin: true } }),
        repository({ id: 2, full_name: 'owl-owner/read-only', permissions: { pull: true } }),
        repository({ id: 3, full_name: 'owl-owner/archived', archived: true, permissions: { push: true } })
      ]));

    const items = await new GitHubClient().listManageableRepositories('provider-token', 42);

    expect(items).toEqual([expect.objectContaining({ id: 1, fullName: 'owl-owner/owlpay', permission: 'admin' })]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer provider-token' });
  });

  it('rejects a provider token belonging to another GitHub account', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ id: 99, login: 'someone-else' }));

    await expect(new GitHubClient().listManageableRepositories('provider-token', 42))
      .rejects.toMatchObject({ code: 'GITHUB_IDENTITY_MISMATCH', statusCode: 403 });
  });

  it('requires write permission before accepting a bounty repository', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ id: 42, login: 'owl-owner' }))
      .mockResolvedValueOnce(jsonResponse(repository({ permissions: { pull: true } })));

    await expect(new GitHubClient().assertCanManageRepository('https://github.com/owl-owner/owlpay', 'provider-token', 42))
      .rejects.toMatchObject({ code: 'REPOSITORY_PERMISSION_REQUIRED', statusCode: 403 });
  });
});

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function repository(overrides: Record<string, unknown> = {}) {
  const fullName = typeof overrides.full_name === 'string' ? overrides.full_name : 'owl-owner/owlpay';
  const [owner, name] = fullName.split('/');
  return {
    id: 1,
    name,
    full_name: fullName,
    html_url: `https://github.com/${fullName}`,
    private: false,
    archived: false,
    owner: { login: owner, avatar_url: null },
    permissions: { admin: false, maintain: false, push: false },
    ...overrides
  };
}
