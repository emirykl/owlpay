import type { Bounty, BountyApplication, Criterion, ReviewPlan, VerificationInput } from '../domain/schemas.js';

export interface BountyRepository {
  list(): Promise<Bounty[]>;
  get(id: string): Promise<Bounty | undefined>;
  save(bounty: Bounty): Promise<void>;
}

export interface ApplicationRepository {
  listByBounty(bountyId: string): Promise<BountyApplication[]>;
  listByDeveloper(developerUserId: string): Promise<BountyApplication[]>;
  get(id: string): Promise<BountyApplication | undefined>;
  findByBountyAndDeveloper(bountyId: string, developerUserId: string): Promise<BountyApplication | undefined>;
  countByBounties(bountyIds: string[]): Promise<Record<string, number>>;
  save(application: BountyApplication): Promise<void>;
  resolveAssignment(bountyId: string, acceptedApplicationId: string): Promise<void>;
}

export interface SettlementGateway {
  readonly writesEnabled: boolean;
  approveAndRelease(onchainId: string, verificationHash: `0x${string}`): Promise<`0x${string}` | null>;
  requestRevision(onchainId: string, verificationHash: `0x${string}`): Promise<`0x${string}` | null>;
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
  reviewPullRequest(url: string, criteria: Criterion[], plan: Exclude<ReviewPlan, 'NONE'>): Promise<VerificationInput>;
  listManageableRepositories(providerToken: string, expectedUserId: number): Promise<ManageableRepository[]>;
  assertCanManageRepository(repositoryUrl: string, providerToken: string, expectedUserId: number): Promise<ManageableRepository>;
}

export interface ReviewPaymentVerifier {
  verify(input: {
    txHash: `0x${string}`;
    payer: `0x${string}`;
    token: `0x${string}`;
    payTo: `0x${string}`;
    amount: bigint;
  }): Promise<void>;
}
