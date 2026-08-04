import { DomainError } from '../domain/errors.js';
import type { GitHubEvidenceProvider, PullRequestEvidence } from '../application/ports.js';

const pullRequestPattern = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?$/;

export class GitHubClient implements GitHubEvidenceProvider {
  constructor(private readonly token = '') {}

  async getPullRequest(url: string): Promise<PullRequestEvidence> {
    const match = pullRequestPattern.exec(url);
    if (!match) throw new DomainError('Invalid GitHub pull request URL');
    const [, owner, repository, number] = match;
    if (!owner || !repository || !number) throw new DomainError('Invalid GitHub pull request URL');

    const response = await fetch(`https://api.github.com/repos/${owner}/${repository}/pulls/${number}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'OwlPay-MVP',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
      },
      signal: AbortSignal.timeout(10_000)
    });

    if (!response.ok) {
      throw new DomainError(`GitHub returned ${response.status}`, response.status === 404 ? 404 : 502, 'GITHUB_ERROR');
    }

    const payload = await response.json() as {
      state: string; head: { sha: string }; changed_files: number; additions: number; deletions: number;
      user: { login: string }; title: string;
    };
    return {
      repositoryUrl: `https://github.com/${owner}/${repository}`,
      pullRequestUrl: url,
      number: Number(number),
      state: payload.state,
      headSha: payload.head.sha,
      changedFiles: payload.changed_files,
      additions: payload.additions,
      deletions: payload.deletions,
      author: payload.user.login,
      title: payload.title
    };
  }
}

