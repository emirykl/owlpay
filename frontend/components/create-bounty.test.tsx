// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateBounty } from './create-bounty';

const contract = '0x1111111111111111111111111111111111111111';
const token = '0x2222222222222222222222222222222222222222';
const wallet = '0x3333333333333333333333333333333333333333';
const approvalHash = `0x${'a'.repeat(64)}`;
const fundingHash = `0x${'b'.repeat(64)}`;
const reviewHash = `0x${'c'.repeat(64)}`;

const { api, chain, walletState, authState } = vi.hoisted(() => ({
  api: {
    createBounty: vi.fn(),
    markFunded: vi.fn(),
    requestReviewPayment: vi.fn(),
    confirmReviewPayment: vi.fn(),
    network: vi.fn(),
    me: vi.fn(),
    listManageableRepositories: vi.fn(),
    createWalletChallenge: vi.fn(),
    verifyWallet: vi.fn()
  },
  chain: { readContract: vi.fn(), waitForTransactionReceipt: vi.fn() },
  walletState: { current: {} as Record<string, unknown> },
  authState: { current: {} as Record<string, unknown> }
}));

vi.mock('@/lib/api', () => ({ owlpayApi: api }));
vi.mock('@/lib/network', () => ({
  goatPublicClient: chain,
  goatTestnet: { id: 48816, name: 'GOAT Testnet3' }
}));
vi.mock('./wallet-provider', () => ({ useWallet: () => walletState.current }));
vi.mock('./auth-provider', () => ({ useAuth: () => authState.current }));

// Animation timing is irrelevant to these rules, and AnimatePresence would
// otherwise keep the outgoing step on screen while assertions run.
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

function renderWizard(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CreateBounty onClose={onClose} />
    </QueryClientProvider>
  );
  return onClose;
}

const primaryButton = () => screen.getByRole('button', { name: /continue|fund|create draft|creating/i }) as HTMLButtonElement;
const field = (placeholder: string | RegExp) => screen.getByPlaceholderText(placeholder);

function setValue(element: Element, value: string) {
  fireEvent.change(element, { target: { value } });
}

function localDateTime(offsetMs: number) {
  const target = new Date(Date.now() + offsetMs);
  return new Date(target.getTime() - target.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** Fills the repository and detail steps, leaving the wizard on reward & review. */
function fillDetails() {
  setValue(field('https://github.com/org/repository'), 'https://github.com/owlpay/demo');
  fireEvent.click(primaryButton());
  setValue(field('Add a health endpoint'), 'Add a health endpoint');
  setValue(field(/Describe the expected outcome/), 'Return a stable health response for uptime checks.');
  fireEvent.click(primaryButton());
}

/**
 * Advances to the funding step and waits for it to settle. The escrow address
 * and token arrive from the network query, and the action only offers to fund
 * once they have, so awaiting the expected label is what proves it is ready.
 */
async function advanceToFunding(label: RegExp) {
  fireEvent.click(primaryButton());
  return screen.findByRole('button', { name: label }) as Promise<HTMLButtonElement>;
}

describe('CreateBounty wizard', () => {
  beforeEach(() => {
    for (const mock of Object.values(api)) mock.mockReset();
    chain.readContract.mockReset();
    chain.waitForTransactionReceipt.mockReset();

    api.network.mockResolvedValue({
      chainId: 48816,
      contractAddress: contract,
      paymentToken: { address: token, symbol: 'USDC', decimals: 6 },
      reviewPaymentToken: { address: token, symbol: 'USDC', decimals: 6 },
      reviewPrices: { standard: '1', security: '2' },
      platformFeeBps: 300,
      writesEnabled: true
    });
    chain.readContract.mockResolvedValue(BigInt('1000000000'));
    walletState.current = { address: wallet, sendTransaction: vi.fn(), payGoatFlowOrder: vi.fn() };
    // Supabase off keeps the repository step a plain URL field, so these tests
    // exercise the wizard rules rather than the GitHub picker.
    authState.current = { configured: false, user: null, githubLogin: null, signIn: vi.fn() };
  });

  afterEach(cleanup);

  it('holds the first step until a repository is named', () => {
    renderWizard();

    expect(primaryButton().disabled).toBe(true);
    setValue(field('https://github.com/org/repository'), 'https://github.com/owlpay/demo');
    expect(primaryButton().disabled).toBe(false);
  });

  it.each([
    ['a title under five characters', 'Add', 'Return a stable health response for uptime checks.'],
    ['a description under ten characters', 'Add a health endpoint', 'Too short']
  ])('refuses to advance past the details step with %s', (_label, title, description) => {
    renderWizard();

    setValue(field('https://github.com/org/repository'), 'https://github.com/owlpay/demo');
    fireEvent.click(primaryButton());
    setValue(field('Add a health endpoint'), title);
    setValue(field(/Describe the expected outcome/), description);

    expect(primaryButton().disabled).toBe(true);
  });

  it.each([
    ['sooner than an hour from now', 30 * 60_000, 'Choose a time at least 1 hour from now.'],
    ['further out than a week', 8 * 24 * 3_600_000, 'Choose a time within the next 7 days.']
  ])('rejects a deadline %s', (_label, offsetMs, warning) => {
    renderWizard();

    setValue(field('https://github.com/org/repository'), 'https://github.com/owlpay/demo');
    fireEvent.click(primaryButton());
    setValue(field('Add a health endpoint'), 'Add a health endpoint');
    setValue(field(/Describe the expected outcome/), 'Return a stable health response for uptime checks.');
    setValue(document.querySelector('input[type="datetime-local"]')!, localDateTime(offsetMs));

    expect(screen.getByText(warning)).toBeTruthy();
    expect(primaryButton().disabled).toBe(true);
  });

  it('prices the review plan the maintainer selects', async () => {
    renderWizard();
    fillDetails();

    fireEvent.click(screen.getByRole('radio', { name: /Security/ }));

    await advanceToFunding(/Fund & pay review/);
    expect(screen.getByText(/Security · 2\.00 USDC paid now/)).toBeTruthy();
  });

  // The whole point of the wizard: escrow is approved, funded, recorded against
  // the draft, and only then may the review be charged for.
  it('funds the escrow and pays for the review in order', async () => {
    const draft = { id: 'bounty-1', reviewPaymentStatus: 'REQUIRED' };
    const funded = { ...draft, status: 'OPEN', reviewPaymentStatus: 'REQUIRED' };
    const order = { orderId: 'flow-order-1', amountWei: '1000000' };

    api.createBounty.mockResolvedValue(draft);
    api.markFunded.mockResolvedValue(funded);
    api.requestReviewPayment.mockResolvedValue(order);
    api.confirmReviewPayment.mockResolvedValue({ ...funded, reviewPaymentStatus: 'PAID' });
    const sendTransaction = vi.fn().mockResolvedValueOnce(approvalHash).mockResolvedValueOnce(fundingHash);
    const payGoatFlowOrder = vi.fn().mockResolvedValue(reviewHash);
    walletState.current = { address: wallet, sendTransaction, payGoatFlowOrder };
    chain.waitForTransactionReceipt.mockImplementation(async ({ hash }: { hash: string }) => hash === fundingHash
      ? { logs: [{ address: contract, topics: [`0x${'d'.repeat(64)}`, `0x${'0'.repeat(63)}7`] }] }
      : {});

    const onClose = renderWizard();
    fillDetails();
    fireEvent.click(await advanceToFunding(/Fund & pay review/));

    await waitFor(() => expect(onClose).toHaveBeenCalled());

    expect(api.createBounty).toHaveBeenCalledWith(expect.objectContaining({
      repositoryUrl: 'https://github.com/owlpay/demo',
      ownerAddress: wallet,
      reviewPlan: 'STANDARD'
    }));
    expect(sendTransaction.mock.calls[0]?.[0].to).toBe(token);
    expect(sendTransaction.mock.calls[1]?.[0].to).toBe(contract);
    // The on chain id comes out of the BountyCreated topic, not from the client.
    expect(api.markFunded).toHaveBeenCalledWith('bounty-1', '7', fundingHash);
    expect(api.requestReviewPayment).toHaveBeenCalledWith('bounty-1', 'STANDARD');
    expect(payGoatFlowOrder).toHaveBeenCalledWith(order);
    expect(api.confirmReviewPayment).toHaveBeenCalledWith('bounty-1', 'flow-order-1', reviewHash);
  });

  it('never charges for a review the maintainer declined', async () => {
    api.createBounty.mockResolvedValue({ id: 'bounty-2', reviewPaymentStatus: 'NOT_REQUIRED' });
    api.markFunded.mockResolvedValue({ id: 'bounty-2', reviewPaymentStatus: 'NOT_REQUIRED' });
    const sendTransaction = vi.fn().mockResolvedValueOnce(approvalHash).mockResolvedValueOnce(fundingHash);
    walletState.current = { address: wallet, sendTransaction, payGoatFlowOrder: vi.fn() };
    chain.waitForTransactionReceipt.mockImplementation(async ({ hash }: { hash: string }) => hash === fundingHash
      ? { logs: [{ address: contract, topics: [`0x${'d'.repeat(64)}`, `0x${'0'.repeat(63)}3`] }] }
      : {});

    const onClose = renderWizard();
    fillDetails();
    fireEvent.click(screen.getByRole('radio', { name: /Manual/ }));
    fireEvent.click(await advanceToFunding(/Fund on testnet/));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.requestReviewPayment).not.toHaveBeenCalled();
    expect(api.confirmReviewPayment).not.toHaveBeenCalled();
  });

  it('reports a refused funding transaction without closing the wizard', async () => {
    api.createBounty.mockResolvedValue({ id: 'bounty-3', reviewPaymentStatus: 'REQUIRED' });
    walletState.current = {
      address: wallet,
      sendTransaction: vi.fn().mockRejectedValue(new Error('Wallet is out of funds.')),
      payGoatFlowOrder: vi.fn()
    };

    const onClose = renderWizard();
    fillDetails();
    fireEvent.click(await advanceToFunding(/Fund & pay review/));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Wallet is out of funds.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('blocks funding while no wallet is connected', async () => {
    walletState.current = { address: null, sendTransaction: vi.fn(), payGoatFlowOrder: vi.fn() };
    renderWizard();

    fillDetails();
    const fund = await advanceToFunding(/Fund & pay review/);

    expect(screen.getByText('Connect MetaMask to fund')).toBeTruthy();
    expect(fund.disabled).toBe(true);
  });

  it('stops at the repository step when the account manages nothing', async () => {
    authState.current = { configured: true, user: { id: 'user-1' }, githubLogin: 'maintainer', signIn: vi.fn() };
    api.listManageableRepositories.mockResolvedValue({ items: [] });
    api.me.mockResolvedValue({
      user: { id: 'user-1', githubLogin: 'maintainer' },
      wallet: { walletAddress: null, verified: false }
    });
    renderWizard();

    await waitFor(() => expect(screen.getByText('No manageable public repository')).toBeTruthy());
    expect(primaryButton().disabled).toBe(true);
  });
});
