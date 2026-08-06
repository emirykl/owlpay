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

describe('GitHub review evidence', () => {
  it('forwards commit-pinned files and checks to the configured AI reviewer', async () => {
    const review = vi.fn(async () => ({
      commitSha: 'a'.repeat(40),
      confidence: 0.94,
      criterionResults: [{ criterionId: 'implementation', status: 'PASSED' as const, evidence: ['file:src/app.ts'], summary: 'Implemented.' }],
      blockingIssues: []
    }));
    const client = new GitHubClient('', { configured: true, review });
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        state: 'open',
        head: { sha: 'a'.repeat(40) },
        changed_files: 1,
        additions: 4,
        deletions: 1,
        user: { id: 7, login: 'developer' },
        title: 'Implement endpoint',
        body: 'Adds the requested endpoint.'
      }))
      .mockResolvedValueOnce(jsonResponse([{
        filename: 'src/app.ts', status: 'modified', additions: 4, deletions: 1, changes: 5, patch: '@@ -1 +1 @@\n-old\n+new'
      }]))
      .mockResolvedValueOnce(jsonResponse({
        check_runs: [{ name: 'unit-tests', status: 'completed', conclusion: 'success', html_url: 'https://github.com/check/1' }]
      }));

    const result = await client.reviewPullRequest(
      'https://github.com/owlpay/demo/pull/42',
      [{ id: 'implementation', description: 'Endpoint is implemented', mandatory: true, method: 'github' }],
      'STANDARD',
      { bountyTitle: 'Implement endpoint', bountyDescription: 'Add an endpoint.', safetyIdentifier: 'owner-hash' }
    );

    expect(result.confidence).toBe(0.94);
    expect(review).toHaveBeenCalledWith(expect.objectContaining({
      plan: 'STANDARD',
      evidence: expect.objectContaining({
        checksAvailable: true,
        diffTruncated: false,
        files: [expect.objectContaining({ filename: 'src/app.ts' })],
        checks: [expect.objectContaining({ name: 'unit-tests', conclusion: 'success' })],
        pullRequest: expect.objectContaining({ headSha: 'a'.repeat(40), body: 'Adds the requested endpoint.' })
      })
    }));
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
