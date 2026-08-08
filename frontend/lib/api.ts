export type BountyStatus =
  | 'DRAFT' | 'OPEN' | 'ASSIGNED' | 'SUBMITTED' | 'VERIFYING' | 'READY_FOR_REVIEW' | 'REVISION_REQUIRED'
  | 'HUMAN_REVIEW' | 'APPROVED' | 'PAID' | 'EXPIRED' | 'REFUNDED' | 'CANCELLED';

export interface Criterion {
  id: string;
  description: string;
  mandatory: boolean;
  method: 'github' | 'ci' | 'static-analysis' | 'manual';
}

export interface Bounty {
  id: string;
  ownerUserId?: string;
  title: string;
  description: string;
  repositoryUrl: string;
  ownerAddress: string;
  rewardAmount: string;
  reviewPlan: 'NONE' | 'STANDARD' | 'SECURITY';
  reviewPrice: string;
  reviewPaidAmount: string;
  reviewPaymentStatus: 'NOT_REQUIRED' | 'REQUIRED' | 'PAID' | 'CONSUMED';
  reviewPaymentTxHash?: string;
  reviewPaymentTxHashes: string[];
  reviewPaymentOrderId?: string;
  reviewPaymentOrderIds?: string[];
  reviewPaymentOrderStatus?: FlowOrderStatus;
  reviewPaymentPendingTxHash?: string;
  reviewPaidAt?: string;
  reviewConsumedAt?: string;
  revisionRequests?: Array<{
    id: string;
    message: string;
    commitSha: string;
    requestedAt: string;
    requestedByGithubLogin?: string;
    extensionGranted?: boolean;
    contributorDeadline?: string;
  }>;
  deadline: string;
  contributorDeadline: string;
  maintainerReviewDeadline: string;
  revisionExtensionUsed: boolean;
  timeoutResolution: 'NONE' | 'AUTO_APPROVED' | 'AUTO_FAILED_PENDING' | 'INCONCLUSIVE' | 'DISPUTED' | 'AUTO_REFUNDED';
  timeoutResolvedAt?: string;
  appealDeadline?: string;
  appealMessage?: string;
  criteria: Criterion[];
  status: BountyStatus;
  createdAt: string;
  applicantCount: number;
  onchainId?: string;
  escrowContractAddress?: string;
  fundingTxHash?: string;
  payoutTxHash?: string;
  refundTxHash?: string;
  assignedDeveloperUserId?: string;
  assignedDeveloperGithubLogin?: string;
  assignedDeveloperAddress?: string;
  assignedAt?: string;
  assignmentTxHash?: string;
  submission?: {
    pullRequestUrl: string;
    commitSha: string;
    submissionHash: string;
    submissionTxHash?: string;
    developerAddress: string;
    developerUserId?: string;
    author?: string;
    changedFiles?: number;
    additions?: number;
    deletions?: number;
  };
  decision?: {
    decision: 'APPROVE' | 'REVISION_REQUIRED' | 'HUMAN_REVIEW';
    confidence: number;
    score?: number;
    taskAssessment?: {
      status: 'FULLY_MET' | 'MOSTLY_MET' | 'PARTIALLY_MET' | 'NOT_MET' | 'UNKNOWN';
      score: number;
      evidence: string[];
      summary: string;
    };
    summary: string;
    blockingIssues: string[];
    criterionResults?: Array<{
      criterionId: string;
      status: 'PASSED' | 'FAILED' | 'UNKNOWN';
      evidence: string[];
      summary: string;
    }>;
    decidedAt?: string;
  };
}

export type ApplicationStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN';

export interface BountyApplication {
  id: string;
  bountyId: string;
  developerUserId: string;
  developerGithubLogin: string;
  developerGithubAvatarUrl: string | null;
  developerAddress: string;
  message: string;
  status: ApplicationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationWithBounty {
  application: BountyApplication;
  bounty: Bounty;
}

export interface NetworkInfo {
  chainId: number;
  name: string;
  explorerUrl: string;
  writesEnabled: boolean;
  contractAddress: string | null;
  paymentTokenAddress: string | null;
  paymentToken: { address: string | null; symbol: string; decimals: number };
  reviewPaymentToken: { address: string | null; symbol: string; decimals: number };
  platformFeeBps: number;
  reviewPrices: { standard: string; security: string };
  status: { connected: boolean; blockNumber: string | null };
}

export interface CurrentIdentity {
  user: { id: string; githubId: number | null; githubLogin: string | null; avatarUrl: string | null; identityVerified: boolean };
  wallet: { walletAddress: string | null; verified: boolean };
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

export type CreateBountyPayload = Pick<Bounty,
  'title' | 'description' | 'repositoryUrl' | 'ownerAddress' | 'rewardAmount' | 'reviewPlan' | 'deadline' | 'criteria'
>;

export type FlowOrderStatus = 'CHECKOUT_VERIFIED' | 'PAYMENT_CONFIRMED' | 'INVOICED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

export interface ReviewPaymentOrder {
  orderId: string;
  flow: 'ERC20_DIRECT' | 'ERC20_3009' | 'ERC20_APPROVE_XFER';
  tokenSymbol: string;
  tokenContract: string;
  fromAddress: string;
  payToAddress: string;
  chainId: number;
  amountWei: string;
  expiresAt: number;
  calldataSignRequest?: Record<string, unknown>;
  x402?: Record<string, unknown>;
  clientTxHash?: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

if (!API_URL && typeof window !== 'undefined') {
  console.error('[OwlPay] NEXT_PUBLIC_API_URL is not set. API calls will fail. Set this environment variable in Vercel to your backend deployment URL.');
}

interface ApiErrorBody {
  message?: string;
  issues?: Array<{ path?: Array<string | number>; message?: string }>;
}

export function formatApiError(body: ApiErrorBody, status: number) {
  const issue = body.issues?.find((item) => item.message);
  if (!issue?.message) return body.message ?? `Request failed (${status})`;
  const field = issue.path?.length ? `${issue.path.join('.')}: ` : '';
  return `${field}${issue.message}`;
}

async function api<T>(path: string, init?: RequestInit, githubAccess = false): Promise<T> {
  const headers = await authenticatedHeaders(githubAccess, typeof init?.body === 'string');
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...headers, ...init?.headers }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: 'Request failed' })) as ApiErrorBody;
    throw new Error(formatApiError(body, response.status));
  }
  return response.json() as Promise<T>;
}

async function authenticatedHeaders(githubAccess = false, jsonBody = false) {
  const { getGitHubProviderToken, getSupabaseBrowserClient } = await import('./supabase');
  const client = getSupabaseBrowserClient();
  const session = client ? (await client.auth.getSession()).data.session : null;
  const token = session?.access_token;
  const githubToken = session?.provider_token ?? getGitHubProviderToken();
  return {
    ...(jsonBody ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(githubAccess && githubToken ? { 'X-GitHub-Token': githubToken } : {})
  };
}

export const owlpayApi = {
  listBounties: () => api<{ items: Bounty[] }>('/api/bounties'),
  getBounty: (id: string) => api<Bounty>(`/api/bounties/${id}`),
  getSubmissionReportEvidence: (id: string) => api<{ author?: string; changedFiles: number; additions: number; deletions: number }>(`/api/bounties/${id}/submission-report-evidence`),
  network: () => api<NetworkInfo>('/api/network'),
  me: () => api<CurrentIdentity>('/api/me'),
  listManageableRepositories: () => api<{ items: ManageableRepository[] }>('/api/github/repositories', undefined, true),
  createWalletChallenge: (address: string) => api<{ challengeId: string; message: string; expiresAt: string }>('/api/wallet/challenge', {
    method: 'POST', body: JSON.stringify({ address })
  }),
  verifyWallet: (challengeId: string, signature: string) => api<{ walletAddress: string | null; verified: boolean }>('/api/wallet/verify', {
    method: 'POST', body: JSON.stringify({ challengeId, signature })
  }),
  createBounty: (input: CreateBountyPayload) =>
    api<Bounty>('/api/bounties', { method: 'POST', body: JSON.stringify(input) }, true),
  markFunded: (id: string, onchainId: string, fundingTxHash: string) =>
    api<Bounty>(`/api/bounties/${id}/funded`, {
      method: 'POST',
      body: JSON.stringify({ onchainId, fundingTxHash })
    }),
  applyToBounty: (id: string, message: string, developerAddress: string) =>
    api<BountyApplication>(`/api/bounties/${id}/applications`, { method: 'POST', body: JSON.stringify({ message, developerAddress }) }),
  listBountyApplications: (id: string) => api<{ items: BountyApplication[] }>(`/api/bounties/${id}/applications`),
  listMyApplications: () => api<{ items: ApplicationWithBounty[] }>('/api/applications/me'),
  assignApplication: (bountyId: string, applicationId: string, assignmentTxHash?: string) =>
    api<Bounty>(`/api/bounties/${bountyId}/applications/${applicationId}/assign`, {
      method: 'POST', body: JSON.stringify({ assignmentTxHash })
    }),
  prepareSubmission: (id: string, pullRequestUrl: string, developerAddress: string) =>
    api<{ submissionHash: `0x${string}`; evidence: { author: string; headSha: string; changedFiles: number; additions: number; deletions: number } }>(`/api/bounties/${id}/submissions/prepare`, {
      method: 'POST', body: JSON.stringify({ pullRequestUrl, developerAddress })
    }),
  submitWork: (id: string, pullRequestUrl: string, developerAddress: string, submissionTxHash?: string) =>
    api<{ bounty: Bounty; evidence: { author: string; headSha: string; changedFiles: number; additions: number; deletions: number } }>(`/api/bounties/${id}/submissions`, {
      method: 'POST',
      body: JSON.stringify({ pullRequestUrl, developerAddress, submissionTxHash })
    }),
  requestReviewPayment: async (id: string, targetPlan?: 'STANDARD' | 'SECURITY') => {
    const response = await fetch(`${API_URL}/api/bounties/${id}/review-payment`, {
      method: 'POST', headers: await authenticatedHeaders(false, true), body: JSON.stringify({ targetPlan })
    });
    const body = await response.json().catch(() => ({ message: 'Payment order could not be created' })) as ReviewPaymentOrder & { message?: string };
    if (response.status !== 402) throw new Error(body.message ?? `Request failed (${response.status})`);
    return body;
  },
  confirmReviewPayment: (id: string, orderId: string, txHash: string) => api<Bounty>(`/api/bounties/${id}/review-payment/confirm`, {
    method: 'POST', body: JSON.stringify({ orderId, txHash })
  }),
  runReview: (id: string) => api<Bounty>(`/api/bounties/${id}/review/run`, { method: 'POST' }),
  approveBounty: (id: string) => api<Bounty>(`/api/bounties/${id}/approve`, { method: 'POST' }),
  requestBountyRevision: (id: string, message: string) => api<Bounty>(`/api/bounties/${id}/request-revision`, {
    method: 'POST', body: JSON.stringify({ message })
  }),
  appealResolution: (id: string, message: string) => api<Bounty>(`/api/bounties/${id}/resolution-appeal`, {
    method: 'POST', body: JSON.stringify({ message })
  }),
  markRefunded: (id: string, refundTxHash: string) => api<Bounty>(`/api/bounties/${id}/refunded`, {
    method: 'POST', body: JSON.stringify({ refundTxHash })
  }),
  withdrawApplication: (applicationId: string) => api<BountyApplication>(`/api/applications/${applicationId}/withdraw`, { method: 'POST' }),
  getApplicationSlots: () => api<{ active: number; max: number; remaining: number }>('/api/applications/slots')
};
