'use client';

import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, OwlMark } from './icons';
import { WalletButton } from './wallet-button';
import { CreateBounty } from './create-bounty';
import { BountyDetail } from './bounty-detail';
import { AuthButton } from './auth-button';
import { IdentityButton } from './identity-button';
import { useAuth } from './auth-provider';
import { useWallet } from './wallet-provider';
import { owlpayApi, type Bounty, type BountyStatus } from '@/lib/api';

type WorkspaceView = 'overview' | 'explore' | 'owned' | 'submissions';

const statusLabels: Record<BountyStatus, string> = {
  DRAFT: 'Draft', OPEN: 'Open', SUBMITTED: 'Submitted', VERIFYING: 'Verifying',
  REVISION_REQUIRED: 'Needs revision', HUMAN_REVIEW: 'Human review', APPROVED: 'Approved',
  PAID: 'Paid', EXPIRED: 'Expired', REFUNDED: 'Refunded', CANCELLED: 'Cancelled'
};

const viewCopy: Record<WorkspaceView, { eyebrow: string; title: string; copy: string }> = {
  overview: { eyebrow: 'Workspace', title: 'Good work starts with a clear next step.', copy: 'Create funded work for your repository or find an open bounty to contribute to.' },
  explore: { eyebrow: 'Marketplace', title: 'Explore open bounties.', copy: 'Review the reward and acceptance criteria before you start working on GitHub.' },
  owned: { eyebrow: 'Repository owner', title: 'Your bounties.', copy: 'Track the work you funded from draft through verification and settlement.' },
  submissions: { eyebrow: 'Developer', title: 'Your submissions.', copy: 'Follow the pull requests you submitted and the Owl Agent decision.' }
};

export function Dashboard({ initialIntent }: { initialIntent?: 'create' | 'explore' }) {
  const reduceMotion = useReducedMotion();
  const { githubLogin } = useAuth();
  const { address } = useWallet();
  const [view, setView] = useState<WorkspaceView>(initialIntent === 'explore' ? 'explore' : 'overview');
  const [creating, setCreating] = useState(initialIntent === 'create');
  const [selectedBounty, setSelectedBounty] = useState<Bounty | null>(null);
  const bounties = useQuery({ queryKey: ['bounties'], queryFn: owlpayApi.listBounties, retry: 1 });
  const network = useQuery({ queryKey: ['network'], queryFn: owlpayApi.network, refetchInterval: 30_000, retry: 1 });
  const items = useMemo(() => bounties.data?.items ?? [], [bounties.data?.items]);

  useEffect(() => {
    if (initialIntent) window.history.replaceState(null, '', '/app');
  }, [initialIntent]);

  const visibleItems = useMemo(() => {
    if (view === 'explore') return items.filter((item) => ['OPEN', 'REVISION_REQUIRED'].includes(item.status));
    if (view === 'owned') return address ? items.filter((item) => item.ownerAddress.toLowerCase() === address.toLowerCase()) : [];
    if (view === 'submissions') return address ? items.filter((item) => item.submission?.developerAddress.toLowerCase() === address.toLowerCase()) : [];
    return items.slice(0, 6);
  }, [address, items, view]);

  const locked = items.filter((item) => !['PAID', 'REFUNDED', 'CANCELLED'].includes(item.status)).reduce((sum, item) => sum + Number(item.rewardAmount), 0);
  const active = items.filter((item) => ['OPEN', 'SUBMITTED', 'VERIFYING', 'REVISION_REQUIRED'].includes(item.status)).length;
  const copy = viewCopy[view];

  return (
    <main className="workspaceShell">
      <aside className="appSidebar">
        <Link className="brand appBrand" href="/" aria-label="OwlPay landing page"><OwlMark className="brandMark" /><span>OwlPay</span></Link>
        <nav className="appNavigation" aria-label="Workspace navigation">
          {([
            ['overview', 'Overview'],
            ['explore', 'Explore'],
            ['owned', 'My bounties'],
            ['submissions', 'My submissions']
          ] as const).map(([id, label]) => (
            <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><span />{label}</button>
          ))}
        </nav>
        <div className="sidebarNetwork"><span className={`statusDot ${network.data?.status.connected ? '' : 'offline'}`} /><div><strong>GOAT Testnet3</strong><small>{network.data?.status.connected ? 'Network connected' : 'Checking network'}</small></div></div>
        <Link className="backToSite" href="/">← Back to website</Link>
      </aside>

      <div className="workspaceBody">
        <header className="appHeader">
          <div><span className="mobileWorkspaceLabel">OwlPay workspace</span></div>
          <div className="appConnections"><AuthButton /><WalletButton /><IdentityButton /></div>
        </header>

        <motion.section className="workspaceContent" key={view} initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}>
          <div className="workspaceHeading">
            <div><span className="eyebrow">{copy.eyebrow}</span><h1>{copy.title}</h1><p>{copy.copy}</p></div>
            {view !== 'submissions' && <button className="primaryButton appPrimary" onClick={() => setCreating(true)}>New bounty <span>＋</span></button>}
          </div>

          {view === 'overview' && (
            <>
              <section className="pathChooser" aria-labelledby="path-title">
                <div className="pathIntro"><span>Start here</span><h2 id="path-title">What do you want to do?</h2><p>You are never locked into a role. Choose the action that matches today.</p></div>
                <motion.button className="pathCard ownerPath" whileHover={reduceMotion ? undefined : { y: -4 }} whileTap={{ scale: 0.99 }} onClick={() => setCreating(true)}>
                  <span className="pathNumber">01</span><div><strong>Create a bounty</strong><p>I own a repository and want to fund a measurable outcome.</p></div><ArrowUpRight />
                </motion.button>
                <motion.button className="pathCard developerPath" whileHover={reduceMotion ? undefined : { y: -4 }} whileTap={{ scale: 0.99 }} onClick={() => setView('explore')}>
                  <span className="pathNumber">02</span><div><strong>Explore bounties</strong><p>I am a developer and want to find clear, rewarded work.</p></div><ArrowUpRight />
                </motion.button>
              </section>

              <section className="setupBar">
                <div><span className={githubLogin ? 'setupCheck done' : 'setupCheck'}>{githubLogin ? '✓' : '1'}</span><p><strong>GitHub</strong><small>{githubLogin ? `Connected as @${githubLogin}` : 'Connect when you select a repository'}</small></p></div>
                <i />
                <div><span className={address ? 'setupCheck done' : 'setupCheck'}>{address ? '✓' : '2'}</span><p><strong>Wallet</strong><small>{address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Connect when you fund or submit'}</small></p></div>
                <i />
                <div><span className="setupCheck">3</span><p><strong>Take action</strong><small>Create a bounty or submit a pull request</small></p></div>
              </section>

              <div className="appMetrics">
                <article><span>Locked rewards</span><strong>{locked.toFixed(2)} <small>USDC</small></strong><p>Across active bounties</p></article>
                <article><span>Active bounties</span><strong>{active}</strong><p>Awaiting verified work</p></article>
                <article><span>Agent network</span><strong className="networkMetric">{network.data?.status.connected ? 'Online' : 'Checking'}</strong><p>{network.data?.status.blockNumber ? `Block ${network.data.status.blockNumber}` : 'GOAT Testnet3'}</p></article>
              </div>
            </>
          )}

          <section className="appBountyPanel">
            <div className="panelHeader"><div><h3>{view === 'overview' ? 'Recent bounties' : copy.title}</h3><span>{visibleItems.length} shown</span></div>{view === 'overview' && <button onClick={() => setView('explore')}>View marketplace <ArrowUpRight /></button>}</div>
            {bounties.isLoading ? <div className="loadingRows"><i /><i /><i /></div> : bounties.isError ? (
              <div className="emptyState"><h3>API is offline</h3><p>Start the backend on port 4000, then refresh this page.</p></div>
            ) : visibleItems.length === 0 ? (
              <EmptyView view={view} connected={Boolean(address)} onCreate={() => setCreating(true)} onExplore={() => setView('explore')} />
            ) : (
              <div className="bountyList">{visibleItems.map((bounty) => (
                <article className="bountyRow" key={bounty.id}>
                  <div className="repoGlyph">{bounty.title.slice(0, 1).toUpperCase()}</div>
                  <div className="bountyName"><strong>{bounty.title}</strong><span>{bounty.repositoryUrl.replace('https://github.com/', '')}</span></div>
                  <span className={`statusBadge status-${bounty.status.toLowerCase()}`}>{statusLabels[bounty.status]}</span>
                  <div className="reward"><strong>{bounty.rewardAmount} USDC</strong><span>{bounty.criteria.length} {bounty.criteria.length === 1 ? 'criterion' : 'criteria'}</span></div>
                  <button className="rowLink" onClick={() => setSelectedBounty(bounty)} aria-label={`Open ${bounty.title} details`}><ArrowUpRight /></button>
                </article>
              ))}</div>
            )}
          </section>
        </motion.section>
      </div>

      {creating && <CreateBounty onClose={() => setCreating(false)} />}
      {selectedBounty && <BountyDetail initialBounty={selectedBounty} onClose={() => setSelectedBounty(null)} />}
    </main>
  );
}

function EmptyView({ view, connected, onCreate, onExplore }: { view: WorkspaceView; connected: boolean; onCreate: () => void; onExplore: () => void }) {
  if ((view === 'owned' || view === 'submissions') && !connected) {
    return <div className="emptyState"><span className="emptyOwl"><OwlMark /></span><h3>Connect your wallet to continue</h3><p>OwlPay uses the connected address to find your {view === 'owned' ? 'funded bounties' : 'submitted work'}.</p></div>;
  }
  if (view === 'submissions') return <div className="emptyState"><span className="emptyOwl"><OwlMark /></span><h3>No submissions yet</h3><p>Explore an open bounty, complete the work on GitHub, then submit your pull request URL.</p><button className="secondaryButton" onClick={onExplore}>Explore bounties</button></div>;
  if (view === 'explore') return <div className="emptyState"><span className="emptyOwl"><OwlMark /></span><h3>No open bounties yet</h3><p>The marketplace is quiet right now. You can create the first funded task.</p><button className="secondaryButton" onClick={onCreate}>Create a bounty</button></div>;
  return <div className="emptyState"><span className="emptyOwl"><OwlMark /></span><h3>No bounties yet</h3><p>Create the first testnet bounty and define evidence the Owl Agent can verify.</p><button className="secondaryButton" onClick={onCreate}>Create first bounty</button></div>;
}
