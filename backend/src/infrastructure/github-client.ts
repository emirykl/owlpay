import { DomainError } from '../domain/errors.js';
import type { Criterion, ReviewPlan, VerificationInput } from '../domain/schemas.js';
import type {
  GitHubEvidenceProvider,
  ManageableRepository,
  PullRequestCheckEvidence,
  PullRequestEvidence,
  PullRequestFileEvidence,
  PullRequestReviewAgent,
  PullRequestReviewContext
} from '../application/ports.js';

const pullRequestPattern = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?$/;
const repositoryPattern = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/?$/;

interface GitHubRepositoryPayload {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  private: boolean;
  archived: boolean;
  owner: { login: string; avatar_url: string | null };
  permissions?: { admin?: boolean; maintain?: boolean; push?: boolean };
}

export class GitHubClient implements GitHubEvidenceProvider {
  constructor(
    private readonly token = '',
    private readonly reviewAgent: PullRequestReviewAgent = unavailableReviewAgent
  ) {}

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
      user: { id: number; login: string }; title: string; body: string | null;
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
      authorId: payload.user.id,
      author: payload.user.login,
      title: payload.title,
      body: payload.body ?? ''
    };
  }

  async reviewPullRequest(
    url: string,
    criteria: Criterion[],
    plan: Exclude<ReviewPlan, 'NONE'>,
    context: PullRequestReviewContext
  ): Promise<VerificationInput> {
    if (!this.reviewAgent.configured) {
      throw new DomainError('Owl Agent AI review is not configured', 503, 'AI_REVIEW_NOT_CONFIGURED');
    }
    const pullRequest = await this.getPullRequest(url);
    const match = pullRequestPattern.exec(url);
    if (!match?.[1] || !match[2] || !match[3]) throw new DomainError('Invalid GitHub pull request URL');
    const [, owner, repository, number] = match;
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'OwlPay-MVP',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
    };
    const [filesResponse, checksResponse] = await Promise.all([
      fetch(`https://api.github.com/repos/${owner}/${repository}/pulls/${number}/files?per_page=100`, {
        headers, signal: AbortSignal.timeout(10_000)
      }),
      fetch(`https://api.github.com/repos/${owner}/${repository}/commits/${pullRequest.headSha}/check-runs?per_page=100`, {
        headers, signal: AbortSignal.timeout(10_000)
      })
    ]);
    if (!filesResponse.ok) throw githubError(filesResponse.status, 'Pull request files could not be loaded');
    const files = await filesResponse.json() as PullRequestFileEvidence[];
    const checks: PullRequestCheckEvidence[] = checksResponse.ok
      ? (await checksResponse.json() as { check_runs: Array<{ name: string; status: string; conclusion: string | null; html_url?: string }> }).check_runs
        .map((check) => ({
          name: check.name,
          status: check.status,
          conclusion: check.conclusion,
          ...(check.html_url ? { url: check.html_url } : {})
        }))
      : [];
    const riskFindings = plan === 'SECURITY' ? scanPatches(files) : [];
    return this.reviewAgent.review({
      evidence: {
        pullRequest,
        files,
        checks,
        checksAvailable: checksResponse.ok,
        diffTruncated: pullRequest.changedFiles > files.length || files.some((file) => typeof file.patch !== 'string'),
        staticFindings: riskFindings
      },
      criteria,
      plan,
      context
    });
  }

  async listManageableRepositories(providerToken: string, expectedUserId: number): Promise<ManageableRepository[]> {
    await this.assertTokenOwner(providerToken, expectedUserId);
    const response = await this.request(
      'https://api.github.com/user/repos?visibility=public&affiliation=owner,collaborator,organization_member&sort=updated&direction=desc&per_page=100',
      providerToken
    );
    if (!response.ok) throw githubError(response.status, 'GitHub repositories could not be loaded');
    const payload = await response.json() as GitHubRepositoryPayload[];
    return payload
      .filter((repository) => !repository.private && !repository.archived && getWritePermission(repository.permissions))
      .map(toManageableRepository);
  }

  async assertCanManageRepository(repositoryUrl: string, providerToken: string, expectedUserId: number): Promise<ManageableRepository> {
    const match = repositoryPattern.exec(repositoryUrl);
    if (!match?.[1] || !match[2]) throw new DomainError('Invalid GitHub repository URL');
    await this.assertTokenOwner(providerToken, expectedUserId);
    const response = await this.request(`https://api.github.com/repos/${match[1]}/${match[2]}`, providerToken);
    if (!response.ok) throw githubError(response.status, 'GitHub repository could not be verified');
    const repository = await response.json() as GitHubRepositoryPayload;
    if (repository.private) throw new DomainError('Private repositories are not supported in the MVP', 400, 'PRIVATE_REPOSITORY');
    if (repository.archived) throw new DomainError('Archived repositories cannot receive bounties', 400, 'ARCHIVED_REPOSITORY');
    if (!getWritePermission(repository.permissions)) {
      throw new DomainError('You need push, maintain, or admin access to create a bounty for this repository', 403, 'REPOSITORY_PERMISSION_REQUIRED');
    }
    return toManageableRepository(repository);
  }

  private async assertTokenOwner(providerToken: string, expectedUserId: number) {
    if (!providerToken) throw new DomainError('Reconnect GitHub to grant repository access', 401, 'GITHUB_RECONNECT_REQUIRED');
    const response = await this.request('https://api.github.com/user', providerToken);
    if (!response.ok) throw githubError(response.status, 'GitHub session could not be verified');
    const user = await response.json() as { id: number };
    if (user.id !== expectedUserId) {
      throw new DomainError('GitHub authorization belongs to a different user', 403, 'GITHUB_IDENTITY_MISMATCH');
    }
  }

  private request(url: string, token: string) {
    return fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'OwlPay-MVP',
        'X-GitHub-Api-Version': '2026-03-10'
      },
      signal: AbortSignal.timeout(10_000)
    });
  }
}

function scanPatches(files: Array<{ filename: string; patch?: string }>) {
  const findings = new Set<string>();
  for (const file of files) {
    const additions = (file.patch ?? '').split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).join('\n');
    if (/BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|(?:api[_-]?key|secret|password)\s*[:=]\s*["'][^"']{12,}/i.test(additions)) {
      findings.add(`Possible secret committed in ${file.filename}`);
    }
    if (/\beval\s*\(|child_process\.(?:exec|spawn)\s*\(/.test(additions)) findings.add(`Risky code execution pattern in ${file.filename}`);
    if (/rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0/.test(additions)) findings.add(`TLS verification disabled in ${file.filename}`);
  }
  return [...findings];
}

const unavailableReviewAgent: PullRequestReviewAgent = {
  configured: false,
  async review() {
    throw new DomainError('Owl Agent AI review is not configured', 503, 'AI_REVIEW_NOT_CONFIGURED');
  }
};

function getWritePermission(permissions?: GitHubRepositoryPayload['permissions']): ManageableRepository['permission'] | null {
  if (permissions?.admin) return 'admin';
  if (permissions?.maintain) return 'maintain';
  if (permissions?.push) return 'push';
  return null;
}

function toManageableRepository(repository: GitHubRepositoryPayload): ManageableRepository {
  const permission = getWritePermission(repository.permissions);
  if (!permission) throw new DomainError('Repository write permission is required', 403, 'REPOSITORY_PERMISSION_REQUIRED');
  return {
    id: repository.id,
    name: repository.name,
    fullName: repository.full_name,
    url: repository.html_url,
    ownerLogin: repository.owner.login,
    ownerAvatarUrl: repository.owner.avatar_url,
    permission
  };
}

function githubError(status: number, message: string) {
  if (status === 401) return new DomainError('Reconnect GitHub to continue', 401, 'GITHUB_RECONNECT_REQUIRED');
  if (status === 403) return new DomainError('GitHub denied repository access', 403, 'GITHUB_ACCESS_DENIED');
  if (status === 404) return new DomainError('GitHub repository was not found', 404, 'GITHUB_NOT_FOUND');
  return new DomainError(message, 502, 'GITHUB_ERROR');
}
