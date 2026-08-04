import type { Bounty } from '../domain/schemas.js';

export interface BountyRepository {
  list(): Promise<Bounty[]>;
  get(id: string): Promise<Bounty | undefined>;
  save(bounty: Bounty): Promise<void>;
}

export interface PullRequestEvidence {
  repositoryUrl: string;
  pullRequestUrl: string;
  number: number;
  state: string;
  headSha: string;
  changedFiles: number;
  additions: number;
  deletions: number;
  authorId: number;
  author: string;
  title: string;
}

export interface ManageableRepository {
  id: number;
  name: string;
  fullName: string;
  url: string;
  ownerLogin: string;
  ownerAvatarUrl: string | null;
  permission: 'admin' | 'maintain' | 'push';
}

export interface GitHubEvidenceProvider {
  getPullRequest(url: string): Promise<PullRequestEvidence>;
  listManageableRepositories(providerToken: string, expectedUserId: number): Promise<ManageableRepository[]>;
  assertCanManageRepository(repositoryUrl: string, providerToken: string, expectedUserId: number): Promise<ManageableRepository>;
}
