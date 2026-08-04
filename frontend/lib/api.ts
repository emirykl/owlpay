export type BountyStatus =
  | 'DRAFT' | 'OPEN' | 'SUBMITTED' | 'VERIFYING' | 'REVISION_REQUIRED'
  | 'HUMAN_REVIEW' | 'APPROVED' | 'PAID' | 'EXPIRED' | 'REFUNDED' | 'CANCELLED';

export interface Criterion {
  id: string;
  description: string;
  mandatory: boolean;
  method: 'github' | 'ci' | 'static-analysis' | 'manual';
}

export interface Bounty {
  id: string;
  title: string;
  description: string;
  repositoryUrl: string;
  ownerAddress: string;
  rewardAmount: string;
  verificationBudget: string;
  deadline: string;
  criteria: Criterion[];
  status: BountyStatus;
  createdAt: string;
  fundingTxHash?: string;
  submission?: { pullRequestUrl: string; commitSha: string; developerAddress: string; developerUserId?: string };
  decision?: {
    decision: 'APPROVE' | 'REVISION_REQUIRED' | 'HUMAN_REVIEW';
    confidence: number;
    summary: string;
    blockingIssues: string[];
  };
}

export interface NetworkInfo {
  chainId: number;
  name: string;
  explorerUrl: string;
  writesEnabled: boolean;
  contractAddress: string | null;
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

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function api<T>(path: string, init?: RequestInit, githubAccess = false): Promise<T> {
  const { getGitHubProviderToken, getSupabaseBrowserClient } = await import('./supabase');
  const client = getSupabaseBrowserClient();
  const session = client ? (await client.auth.getSession()).data.session : null;
  const token = session?.access_token;
  const githubToken = session?.provider_token ?? getGitHubProviderToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(githubAccess && githubToken ? { 'X-GitHub-Token': githubToken } : {}),
      ...init?.headers
    }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: 'Request failed' })) as { message?: string };
    throw new Error(body.message ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
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
  createBounty: (input: Omit<Bounty, 'id' | 'status' | 'createdAt' | 'submission'>) =>
    api<Bounty>('/api/bounties', { method: 'POST', body: JSON.stringify(input) }, true),
  markFunded: (id: string, onchainId: string, fundingTxHash: string) =>
    api<Bounty>(`/api/bounties/${id}/funded`, {
      method: 'POST',
      body: JSON.stringify({ onchainId, fundingTxHash })
    }),
  submitWork: (id: string, pullRequestUrl: string, developerAddress: string) =>
    api<{ bounty: Bounty; evidence: { author: string; headSha: string; changedFiles: number; additions: number; deletions: number } }>(`/api/bounties/${id}/submissions`, {
      method: 'POST',
      body: JSON.stringify({ pullRequestUrl, developerAddress })
    })
};
