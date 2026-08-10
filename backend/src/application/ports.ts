import type { Bounty, BountyApplication, BountyStatus, BrowserReviewPaymentOrder, Criterion, ReviewPlan, VerificationInput } from '../domain/schemas.js';

export interface BountyRepository {
  /** Marketplace listing, newest first, capped so the query can never grow unbounded. */
  list(limit: number): Promise<Bounty[]>;
  /**
   * Only the bounties whose contributor, maintainer or appeal deadline has
   * elapsed. Filtering in the database keeps the scheduled resolver from
   * reading the whole table on every run.
   */
  listResolvable(now: Date): Promise<Bounty[]>;
  /**
   * Whether this settlement transaction or payment order already bought a
   * review. The unique indexes from migrations 0004 and 0007 are the actual
   * guarantee; this reports the conflict before any on-chain work is done.
   */
  findReviewPaymentConflict(txHash: string, orderId: string, excludeBountyId: string): Promise<boolean>;
  get(id: string): Promise<Bounty | undefined>;
  save(bounty: Bounty): Promise<void>;
  /**
   * Compare-and-set write. Persists the bounty only while the stored row still
   * carries `expectedStatus`, and reports whether the write won the race. Used
   * to claim a state transition before an expensive or billable side effect.
   */
  saveIfStatus(bounty: Bounty, expectedStatus: BountyStatus): Promise<boolean>;
  /**
   * Persists only the columns the review purchase owns.
   *
   * Buying a review spans several gateway round trips, so the bounty read at
   * the start of that flow is stale by the time it ends. Writing the whole row
   * back would undo whatever landed meanwhile — a submission, an assignment, a
   * maintainer decision. A payment and a delivery are independent facts, and
   * narrowing the write to the payment columns lets both stand.
   */
  saveReviewPayment(bounty: Bounty): Promise<void>;
}

/**
 * Durable record of bounties a scheduled run could not settle.
 *
 * A resolution run reports failures rather than throwing, so without somewhere
 * to put them the only trace is a log line with the host's retention. An
 * implementation must never throw: losing the record of a failure is bad, but
 * failing the settlement run that produced it is worse.
 */
export interface ResolutionFailureLog {
  record(failures: Array<{ bountyId: string; reason: string }>, runAt: Date): Promise<void>;
}

export interface ApplicationRepository {
  listByBounty(bountyId: string): Promise<BountyApplication[]>;
  listByDeveloper(developerUserId: string): Promise<BountyApplication[]>;
  get(id: string): Promise<BountyApplication | undefined>;
  findByBountyAndDeveloper(bountyId: string, developerUserId: string): Promise<BountyApplication | undefined>;
  countByBounties(bountyIds: string[]): Promise<Record<string, number>>;
  save(application: BountyApplication): Promise<void>;
  resolveAssignment(bountyId: string, acceptedApplicationId: string): Promise<void>;
  countPendingByDeveloper(developerUserId: string): Promise<number>;
  withdraw(applicationId: string): Promise<void>;
}

export interface SettlementGateway {
  readonly writesEnabled: boolean;
  approveAndRelease(onchainId: string, verificationHash: `0x${string}`, escrowContractAddress?: string): Promise<`0x${string}` | null>;
  requestRevision(onchainId: string, verificationHash: `0x${string}`, escrowContractAddress?: string): Promise<`0x${string}` | null>;
  approveAfterTimeout(onchainId: string, verificationHash: `0x${string}`, escrowContractAddress?: string): Promise<`0x${string}` | null>;
  refundAfterTimeout(onchainId: string, verificationHash: `0x${string}`, escrowContractAddress?: string): Promise<`0x${string}` | null>;
}

export interface PullRequestEvidence {
  repositoryUrl: string;
  pullRequestUrl: string;
  number: number;
  state: string;
  merged: boolean;
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
