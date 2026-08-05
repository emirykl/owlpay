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
  reviewPlan: 'STANDARD' | 'SECURITY';
  reviewPrice: string;
  reviewPaymentStatus: 'REQUIRED' | 'PAID' | 'CONSUMED';
  reviewPaymentTxHash?: string;
  reviewPaidAt?: string;
  reviewConsumedAt?: string;
  deadline: string;
  criteria: Criterion[];
  status: BountyStatus;
  createdAt: string;
  applicantCount: number;
  onchainId?: string;
  fundingTxHash?: string;
  payoutTxHash?: string;
  assignedDeveloperUserId?: string;
  assignedDeveloperGithubLogin?: string;
  assignedDeveloperAddress?: string;
  assignedAt?: string;
  assignmentTxHash?: string;
  submission?: { pullRequestUrl: string; commitSha: string; submissionHash: string; submissionTxHash?: string; developerAddress: string; developerUserId?: string };
  decision?: {
    decision: 'APPROVE' | 'REVISION_REQUIRED' | 'HUMAN_REVIEW';
    confidence: number;
    summary: string;
    blockingIssues: string[];
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

export interface ReviewPaymentRequirement {
  x402Version: 2;
  orderId: string;
  resource: { url: string; description: string; mimeType: string };
  accepts: Array<{
    scheme: 'exact';
    network: 'eip155:48816';
    amount: string;
    asset: `0x${string}`;
    payTo: `0x${string}`;
    maxTimeoutSeconds: number;
    extra: { name: string; version: string; decimals: number };
  }>;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function api<T>(path: string, init?: RequestInit, githubAccess = false): Promise<T> {
  const headers = await authenticatedHeaders(githubAccess);
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...headers, ...init?.headers }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: 'Request failed' })) as { message?: string };
    throw new Error(body.message ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

async function authenticatedHeaders(githubAccess = false) {
  const { getGitHubProviderToken, getSupabaseBrowserClient } = await import('./supabase');
  const client = getSupabaseBrowserClient();
  const session = client ? (await client.auth.getSession()).data.session : null;
  const token = session?.access_token;
  const githubToken = session?.provider_token ?? getGitHubProviderToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(githubAccess && githubToken ? { 'X-GitHub-Token': githubToken } : {})
  };
}

export const owlpayApi = {
  listBounties: () => api<{ items: Bounty[] }>('/api/bounties'),
  getBounty: (id: string) => api<Bounty>(`/api/bounties/${id}`),
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
  requestReviewPayment: async (id: string) => {
    const response = await fetch(`${API_URL}/api/bounties/${id}/review-payment`, {
      method: 'POST', headers: await authenticatedHeaders()
    });
    const body = await response.json().catch(() => ({ message: 'Payment requirement could not be loaded' })) as ReviewPaymentRequirement & { message?: string };
    if (response.status !== 402) throw new Error(body.message ?? `Request failed (${response.status})`);
    return body;
  },
  confirmReviewPayment: (id: string, txHash: string) => api<Bounty>(`/api/bounties/${id}/review-payment/confirm`, {
    method: 'POST', body: JSON.stringify({ txHash })
  }),
  runReview: (id: string) => api<Bounty>(`/api/bounties/${id}/review/run`, { method: 'POST' }),
  approveBounty: (id: string) => api<Bounty>(`/api/bounties/${id}/approve`, { method: 'POST' }),
  requestBountyRevision: (id: string) => api<Bounty>(`/api/bounties/${id}/request-revision`, { method: 'POST' })
};
