import type { Bounty, BountyApplication, BrowserReviewPaymentOrder, Criterion, ReviewPlan, VerificationInput } from '../domain/schemas.js';

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
  body: string;
}

export interface PullRequestFileEvidence {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface PullRequestCheckEvidence {
  name: string;
  status: string;
  conclusion: string | null;
  url?: string;
}

export interface PullRequestReviewEvidence {
  pullRequest: PullRequestEvidence;
  files: PullRequestFileEvidence[];
  checks: PullRequestCheckEvidence[];
  checksAvailable: boolean;
  diffTruncated: boolean;
  staticFindings: string[];
}

export interface PullRequestReviewContext {
  bountyTitle: string;
  bountyDescription: string;
  safetyIdentifier: string;
}

export interface PullRequestReviewAgent {
  readonly configured: boolean;
  review(input: {
    evidence: PullRequestReviewEvidence;
    criteria: Criterion[];
    plan: Exclude<ReviewPlan, 'NONE'>;
    context: PullRequestReviewContext;
  }): Promise<VerificationInput>;
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
  reviewPullRequest(
    url: string,
    criteria: Criterion[],
    plan: Exclude<ReviewPlan, 'NONE'>,
    context: PullRequestReviewContext
  ): Promise<VerificationInput>;
  listManageableRepositories(providerToken: string, expectedUserId: number): Promise<ManageableRepository[]>;
  assertCanManageRepository(repositoryUrl: string, providerToken: string, expectedUserId: number): Promise<ManageableRepository>;
}

export type FlowOrderStatus = 'CHECKOUT_VERIFIED' | 'PAYMENT_CONFIRMED' | 'INVOICED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

export interface ReviewPaymentGateway {
  readonly configured: boolean;
  createOrder(input: {
    dappOrderId: string;
    payer: `0x${string}`;
    amountWei: string;
  }): Promise<BrowserReviewPaymentOrder>;
  getOrderStatus(orderId: string): Promise<{
    orderId: string;
    dappOrderId: string;
    status: FlowOrderStatus;
    chainId: number;
    tokenContract: string;
    tokenSymbol: string;
    fromAddress: string;
    amountWei: string;
    txHash?: string;
    confirmedAt?: string;
  }>;
  waitForConfirmation(orderId: string): Promise<{
    orderId: string;
    dappOrderId: string;
    status: FlowOrderStatus;
    chainId: number;
    tokenContract: string;
    tokenSymbol: string;
    fromAddress: string;
    amountWei: string;
    txHash?: string;
    confirmedAt?: string;
  }>;
  getOrderProof(orderId: string): Promise<{
    payload: {
      order_id: string;
      tx_hash: string;
      log_index: number;
      from_addr: string;
      to_addr: string;
      amount_wei: string;
      from_chain_id: number;
      status: string;
    };
    signature: string;
  }>;
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
