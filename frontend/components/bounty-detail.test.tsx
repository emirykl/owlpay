// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bounty } from '@/lib/api';
import { BountyDetail } from './bounty-detail';

const maintainer = { id: 'owner-user', login: 'maintainer' };
const contributor = { id: 'developer-user', login: 'developer' };
const ownerWallet = '0x1111111111111111111111111111111111111111';
const developerWallet = '0x2222222222222222222222222222222222222222';

const { api, chain, walletState, authState } = vi.hoisted(() => ({
  api: {
    getBounty: vi.fn(),
    me: vi.fn(),
    network: vi.fn(),
    listBountyApplications: vi.fn(),
    listMyApplications: vi.fn(),
    getApplicationSlots: vi.fn(),
    applyToBounty: vi.fn(),
    assignApplication: vi.fn(),
    prepareSubmission: vi.fn(),
    submitWork: vi.fn(),
    approveBounty: vi.fn(),
    requestBountyRevision: vi.fn(),
    requestReviewPayment: vi.fn(),
    confirmReviewPayment: vi.fn(),
    runReview: vi.fn(),
    appealResolution: vi.fn(),
    markRefunded: vi.fn(),
    getSubmissionReportEvidence: vi.fn()
  },
  chain: { readContract: vi.fn(), waitForTransactionReceipt: vi.fn() },
  walletState: { current: {} as Record<string, unknown> },
  authState: { current: {} as Record<string, unknown> }
}));

vi.mock('@/lib/api', () => ({ owlpayApi: api }));
vi.mock('@/lib/network', () => ({
  goatPublicClient: chain,
  goatTestnet: { id: 48816, name: 'GOAT Testnet3', blockExplorers: { default: { url: 'https://explorer.example' } } }
}));
vi.mock('./wallet-provider', () => ({ useWallet: () => walletState.current }));
vi.mock('./auth-provider', () => ({ useAuth: () => authState.current }));
vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  useReducedMotion: () => true,
  motion: new Proxy({} as Record<string, unknown>, {
    get: (_target, tag: string) => function MotionElement(props: Record<string, unknown>) {
      const { children, initial, animate, exit, transition, whileHover, ...rest } = props;
      void initial; void animate; void exit; void transition; void whileHover;
      return createElement(tag, rest, children as ReactNode);
    }
  })
}));

const hour = 3_600_000;
const day = 24 * hour;

function bounty(overrides: Partial<Bounty> = {}): Bounty {
  return {
    id: 'bounty-1',
    ownerUserId: maintainer.id,
    title: 'Add a health endpoint',
    description: 'Return a stable service health response.',
    repositoryUrl: 'https://github.com/owlpay/demo',
    ownerAddress: ownerWallet,
    rewardAmount: '20',
    reviewPlan: 'STANDARD',
    reviewPrice: '1',
    reviewPaidAmount: '0',
    reviewPaymentStatus: 'REQUIRED',
    reviewPaymentTxHashes: [],
    revisionRequests: [],
    deadline: new Date(Date.now() + 3 * day).toISOString(),
    contributorDeadline: new Date(Date.now() + 3 * day).toISOString(),
    maintainerReviewDeadline: new Date(Date.now() + 10 * day).toISOString(),
    revisionExtensionUsed: false,
    timeoutResolution: 'NONE',
    criteria: [{ id: 'health', description: 'GET /health returns HTTP 200', mandatory: true, method: 'ci' }],
    status: 'OPEN',
    createdAt: new Date().toISOString(),
    applicantCount: 0,
    ...overrides
  } as Bounty;
}

function signedInAs(account: { id: string; login: string } | null) {
  authState.current = {
    configured: true,
    user: account ? { id: account.id } : null,
    githubLogin: account?.login ?? null,
    signIn: vi.fn()
  };
}

function connect(address: string | null) {
  walletState.current = {
    address,
    sendTransaction: vi.fn(),
    payGoatFlowOrder: vi.fn(),
    signMessage: vi.fn()
  };
  api.me.mockResolvedValue({
    user: { id: 'any', githubLogin: 'any' },
    wallet: { walletAddress: address, verified: Boolean(address) }
  });
}

function renderDetail(initial: Bounty, onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.getBounty.mockResolvedValue(initial);
  render(
    <QueryClientProvider client={client}>
      <BountyDetail initialBounty={initial} onClose={onClose} />
    </QueryClientProvider>
  );
  return onClose;
}

describe('BountyDetail', () => {
  beforeEach(() => {
    for (const mock of Object.values(api)) mock.mockReset();
    api.network.mockResolvedValue({
      chainId: 48816,
      contractAddress: null,
      paymentToken: { address: null, symbol: 'USDC', decimals: 6 },
      reviewPaymentToken: { address: null, symbol: 'USDC', decimals: 6 },
      reviewPrices: { standard: '1', security: '2' },
      platformFeeBps: 300,
      writesEnabled: false
    });
    api.listBountyApplications.mockResolvedValue({ items: [] });
    api.listMyApplications.mockResolvedValue({ items: [] });
    api.getApplicationSlots.mockResolvedValue({ pending: 0, maxPending: 5, remaining: 5 });
    signedInAs(contributor);
    connect(developerWallet);
  });

  afterEach(cleanup);

  it('shows the reward, repository and criteria to anyone', () => {
    signedInAs(null);
    connect(null);
    renderDetail(bounty());

    expect(screen.getByText('Add a health endpoint')).toBeTruthy();
    expect(screen.getByText('owlpay/demo')).toBeTruthy();
    expect(screen.getByText('20 USDC')).toBeTruthy();
    expect(screen.getByText('GET /health returns HTTP 200')).toBeTruthy();
  });

  it('holds the application until the contributor writes a real message', async () => {
    renderDetail(bounty());

    const message = await screen.findByPlaceholderText(/Briefly explain your experience/);
    const send = screen.getByRole('button', { name: /Send application/ }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    fireEvent.change(message, { target: { value: 'too short' } });
    expect(send.disabled).toBe(true);

    fireEvent.change(message, { target: { value: 'I have shipped similar health endpoints before.' } });
    expect(send.disabled).toBe(false);
  });

  it('applies with the connected payout wallet', async () => {
    api.applyToBounty.mockResolvedValue({ id: 'application-1' });
    renderDetail(bounty());

    const message = await screen.findByPlaceholderText(/Briefly explain your experience/);
    fireEvent.change(message, { target: { value: 'I have shipped similar health endpoints before.' } });
    fireEvent.click(screen.getByRole('button', { name: /Send application/ }));

    await waitFor(() => expect(api.applyToBounty).toHaveBeenCalledWith(
      'bounty-1',
      'I have shipped similar health endpoints before.',
      developerWallet
    ));
  });

  it('offers the maintainer the applicant list rather than the application form', async () => {
    signedInAs(maintainer);
    connect(ownerWallet);
    api.listBountyApplications.mockResolvedValue({
      items: [{
        id: 'application-1',
        bountyId: 'bounty-1',
        developerUserId: contributor.id,
        developerGithubLogin: 'developer',
        developerGithubAvatarUrl: null,
        developerAddress: developerWallet,
        message: 'I can deliver this quickly.',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }]
    });
    renderDetail(bounty());

    expect(await screen.findByText('@developer')).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Briefly explain your experience/)).toBeNull();
  });

  it('assigns the bounty to a pending applicant', async () => {
    signedInAs(maintainer);
    connect(ownerWallet);
    api.listBountyApplications.mockResolvedValue({
      items: [{
        id: 'application-1',
        bountyId: 'bounty-1',
        developerUserId: contributor.id,
        developerGithubLogin: 'developer',
        developerGithubAvatarUrl: null,
        developerAddress: developerWallet,
        message: 'I can deliver this quickly.',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }]
    });
    api.assignApplication.mockResolvedValue(bounty({ status: 'ASSIGNED' }));
    renderDetail(bounty());

    fireEvent.click(await screen.findByRole('button', { name: /Assign bounty/ }));

    await waitFor(() => expect(api.assignApplication).toHaveBeenCalledWith('bounty-1', 'application-1', undefined));
  });

  // The report is maintainer only, so the contributor must not be able to read
  // the verdict on their own work before the maintainer acts on it.
  it('keeps the Owl AI report with the maintainer', async () => {
    const reviewed = bounty({
      status: 'READY_FOR_REVIEW',
      assignedDeveloperUserId: contributor.id,
      assignedDeveloperGithubLogin: 'developer',
      assignedDeveloperAddress: developerWallet,
      decision: {
        decision: 'APPROVE',
        confidence: 0.9,
        summary: 'Everything requested is present.',
        blockingIssues: [],
        criterionResults: [],
        taskAssessment: { status: 'FULLY_MET', score: 92, evidence: [], summary: 'Complete.' }
      }
    });

    renderDetail(reviewed);
    expect(screen.queryByText('Owl AI task score')).toBeNull();
    cleanup();

    signedInAs(maintainer);
    connect(ownerWallet);
    renderDetail(reviewed);
    expect(await screen.findByText('Owl AI task score')).toBeTruthy();
  });

  it('sends the assigned contributor pull request for verification', async () => {
    const assigned = bounty({
      status: 'ASSIGNED',
      assignedDeveloperUserId: contributor.id,
      assignedDeveloperGithubLogin: 'developer',
      assignedDeveloperAddress: developerWallet
    });
    api.prepareSubmission.mockResolvedValue({ submissionHash: `0x${'a'.repeat(64)}` });
    api.submitWork.mockResolvedValue({ bounty: assigned, evidence: { headSha: 'abcdef1234567890' } });
    renderDetail(assigned);

    fireEvent.change(screen.getByLabelText('Pull request URL'), { target: { value: 'https://github.com/owlpay/demo/pull/42' } });
    fireEvent.click(screen.getByRole('button', { name: /Send for verification/ }));

    await waitFor(() => expect(api.submitWork).toHaveBeenCalledWith(
      'bounty-1',
      'https://github.com/owlpay/demo/pull/42',
      developerWallet,
      undefined
    ));
  });

  // The payout address was agreed when the application was accepted, so a
  // different wallet must never be able to slip into the submission.
  it('refuses a submission signed from a wallet that was not accepted', async () => {
    const assigned = bounty({
      status: 'ASSIGNED',
      assignedDeveloperUserId: contributor.id,
      assignedDeveloperGithubLogin: 'developer',
      assignedDeveloperAddress: '0x9999999999999999999999999999999999999999'
    });
    renderDetail(assigned);

    fireEvent.change(screen.getByLabelText('Pull request URL'), { target: { value: 'https://github.com/owlpay/demo/pull/42' } });
    fireEvent.click(screen.getByRole('button', { name: /Send for verification/ }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Connect the payout wallet used in your accepted application.');
    expect(api.prepareSubmission).not.toHaveBeenCalled();
    expect(api.submitWork).not.toHaveBeenCalled();
  });

  it('releases the escrow when the maintainer approves', async () => {
    signedInAs(maintainer);
    connect(ownerWallet);
    const submitted = bounty({
      status: 'SUBMITTED',
      reviewPlan: 'NONE',
      reviewPaymentStatus: 'NOT_REQUIRED',
      assignedDeveloperUserId: contributor.id,
      submission: {
        pullRequestUrl: 'https://github.com/owlpay/demo/pull/42',
        commitSha: 'a'.repeat(40),
        submissionHash: `0x${'b'.repeat(64)}`,
        developerAddress: developerWallet
      }
    });
    api.approveBounty.mockResolvedValue(bounty({ status: 'PAID' }));
    renderDetail(submitted);

    fireEvent.click(await screen.findByRole('button', { name: /Approve & release/ }));

    await waitFor(() => expect(api.approveBounty).toHaveBeenCalledWith('bounty-1'));
  });

  it('stops the maintainer at the two revision limit', async () => {
    signedInAs(maintainer);
    connect(ownerWallet);
    const twiceRevised = bounty({
      status: 'SUBMITTED',
      reviewPlan: 'NONE',
      reviewPaymentStatus: 'NOT_REQUIRED',
      assignedDeveloperUserId: contributor.id,
      revisionRequests: [
        { id: 'r1', message: 'First pass needs work.', commitSha: 'a'.repeat(40), requestedAt: new Date().toISOString() },
        { id: 'r2', message: 'Still not complete.', commitSha: 'b'.repeat(40), requestedAt: new Date().toISOString() }
      ],
      submission: {
        pullRequestUrl: 'https://github.com/owlpay/demo/pull/42',
        commitSha: 'a'.repeat(40),
        submissionHash: `0x${'b'.repeat(64)}`,
        developerAddress: developerWallet
      }
    });
    renderDetail(twiceRevised);

    const revision = await screen.findByRole('button', { name: /Request revision/ }) as HTMLButtonElement;
    expect(revision.disabled).toBe(true);
    expect(revision.title).toBe('The two-revision limit has been reached.');
  });

  it('offers the escrow back once the delivery window closed with nothing delivered', async () => {
    signedInAs(maintainer);
    connect(ownerWallet);
    const expired = bounty({
      status: 'ASSIGNED',
      contributorDeadline: new Date(Date.now() - day).toISOString(),
      deadline: new Date(Date.now() - day).toISOString(),
      assignedDeveloperUserId: contributor.id
    });
    renderDetail(expired);

    expect(await screen.findByText('Contributor delivery window ended')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Refund escrow/ })).toBeTruthy();
  });
});
