// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bounty } from '@/lib/api';
import { Dashboard } from './dashboard';

const maintainer = { id: 'owner-user', login: 'maintainer' };
const ownerWallet = '0x1111111111111111111111111111111111111111';
const otherWallet = '0x2222222222222222222222222222222222222222';

const { api, walletState, authState } = vi.hoisted(() => ({
  api: {
    listBounties: vi.fn(),
    listMyApplications: vi.fn(),
    getApplicationSlots: vi.fn(),
    network: vi.fn()
  },
  walletState: { current: {} as Record<string, unknown> },
  authState: { current: {} as Record<string, unknown> }
}));

vi.mock('@/lib/api', () => ({ owlpayApi: api }));
vi.mock('./wallet-provider', () => ({ useWallet: () => walletState.current }));
vi.mock('./auth-provider', () => ({ useAuth: () => authState.current }));
// The workspace is what is under test; the panels it can open have their own
// suites and would only pull their whole dependency graph in here.
vi.mock('./create-bounty', () => ({ CreateBounty: () => <div>create bounty panel</div> }));
vi.mock('./bounty-detail', () => ({ BountyDetail: ({ initialBounty }: { initialBounty: Bounty }) => <div>detail: {initialBounty.title}</div> }));
vi.mock('./auth-button', () => ({ AuthButton: () => <button>auth</button> }));
vi.mock('./identity-button', () => ({ IdentityButton: () => <button>identity</button> }));
vi.mock('./wallet-button', () => ({ WalletButton: () => <button>wallet</button> }));
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

const day = 24 * 3_600_000;

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
  authState.current = { configured: true, user: account ? { id: account.id } : null, githubLogin: account?.login ?? null, signIn: vi.fn() };
}

function renderDashboard(items: Bounty[], view?: 'explore' | 'owned' | 'applications') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.listBounties.mockResolvedValue({ items });
  render(
    <QueryClientProvider client={client}>
      <Dashboard initialView={view} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  signedInAs(maintainer);
  walletState.current = { address: null };
  api.network.mockResolvedValue({ status: { connected: true }, paymentToken: { symbol: 'USDC', decimals: 6 } });
  api.listMyApplications.mockResolvedValue({ items: [] });
  api.getApplicationSlots.mockResolvedValue({ pending: 0, maxPending: 5, remaining: 5, active: 0, max: 5 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('dashboard marketplace', () => {
  it('keeps unfunded drafts out of the public marketplace', async () => {
    renderDashboard([
      bounty({ id: 'public', title: 'Funded and listed' }),
      bounty({ id: 'draft', title: 'Still a draft', status: 'DRAFT' })
    ]);

    await waitFor(() => expect(screen.getByText('Funded and listed')).toBeTruthy());
    expect(screen.queryByText('Still a draft')).toBeNull();
    // The counter is the marketplace total, so a draft must not inflate it.
    expect(screen.getByText('Total bounties').nextSibling?.textContent).toBe('1');
  });

  it('narrows the marketplace by search text', async () => {
    renderDashboard([
      bounty({ id: 'a', title: 'Add a health endpoint' }),
      bounty({ id: 'b', title: 'Migrate the payment gateway', description: 'Move settlement onto the new provider.' })
    ]);
    await waitFor(() => expect(screen.getByText('Migrate the payment gateway')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Search bounties'), { target: { value: 'health' } });

    expect(screen.getByText('Add a health endpoint')).toBeTruthy();
    expect(screen.queryByText('Migrate the payment gateway')).toBeNull();
  });

  it('hides an open bounty whose deadline has already passed', async () => {
    renderDashboard([
      bounty({ id: 'live', title: 'Still accepting work' }),
      bounty({ id: 'closed', title: 'Deadline already gone', deadline: new Date(Date.now() - day).toISOString() })
    ]);
    await waitFor(() => expect(screen.getByText('Still accepting work')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'OPEN' } });

    // Filtering for OPEN means "can I apply", so a closed window drops out even
    // though the stored status has not moved yet.
    expect(screen.getByText('Still accepting work')).toBeTruthy();
    expect(screen.queryByText('Deadline already gone')).toBeNull();
  });

  it('clears every filter at once', async () => {
    renderDashboard([bounty({ id: 'a', title: 'Add a health endpoint' })]);
    await waitFor(() => expect(screen.getByText('Add a health endpoint')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Search bounties'), { target: { value: 'nothing matches this' } });
    expect(screen.queryByText('Add a health endpoint')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(screen.getByText('Add a health endpoint')).toBeTruthy();
  });
});

describe('dashboard my bounties view', () => {
  it('shows only what the signed-in account owns', async () => {
    renderDashboard([
      bounty({ id: 'mine', title: 'My own bounty' }),
      bounty({ id: 'theirs', title: 'Someone else bounty', ownerUserId: 'another-user', ownerAddress: otherWallet })
    ], 'owned');

    await waitFor(() => expect(screen.getByText('My own bounty')).toBeTruthy());
    expect(screen.queryByText('Someone else bounty')).toBeNull();
  });

  it('recognises ownership through the connected wallet when the row predates accounts', async () => {
    signedInAs(null);
    walletState.current = { address: ownerWallet.toUpperCase() };
    renderDashboard([
      bounty({ id: 'mine', title: 'Wallet owned bounty', ownerUserId: undefined }),
      bounty({ id: 'theirs', title: 'Someone else bounty', ownerUserId: 'another-user', ownerAddress: otherWallet })
    ], 'owned');

    await waitFor(() => expect(screen.getByText('Wallet owned bounty')).toBeTruthy());
    expect(screen.queryByText('Someone else bounty')).toBeNull();
  });

  it('lists a draft to its owner even though the marketplace hides it', async () => {
    renderDashboard([bounty({ id: 'draft', title: 'Still a draft', status: 'DRAFT' })], 'owned');

    await waitFor(() => expect(screen.getByText('Still a draft')).toBeTruthy());
  });
});

describe('dashboard applications view', () => {
  it('asks an anonymous visitor to connect GitHub instead of calling the API', async () => {
    signedInAs(null);
    renderDashboard([], 'applications');

    await waitFor(() => expect(screen.getByText('Connect GitHub to see your applications')).toBeTruthy());
    expect(api.listMyApplications).not.toHaveBeenCalled();
  });

  it('reports pending slots and counts accepted applications separately', async () => {
    api.getApplicationSlots.mockResolvedValue({ pending: 2, maxPending: 5, remaining: 3, active: 2, max: 5 });
    api.listMyApplications.mockResolvedValue({
      items: [
        { application: { id: 'app-1', status: 'ACCEPTED', bountyId: 'bounty-1', developerUserId: maintainer.id, message: 'ready', createdAt: new Date().toISOString() }, bounty: bounty({ id: 'bounty-1' }) },
        { application: { id: 'app-2', status: 'PENDING', bountyId: 'bounty-2', developerUserId: maintainer.id, message: 'ready', createdAt: new Date().toISOString() }, bounty: bounty({ id: 'bounty-2', title: 'Second bounty' }) }
      ]
    });
    renderDashboard([], 'applications');

    await waitFor(() => expect(screen.getByText(/pending slots/)).toBeTruthy());
    expect(screen.getByText('2/5 pending slots · 1 accepted (no limit)')).toBeTruthy();
  });
});
