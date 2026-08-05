'use client';

import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Calendar, OwlMark, Users } from './icons';
import { WalletButton } from './wallet-button';
import { CreateBounty } from './create-bounty';
import { BountyDetail } from './bounty-detail';
import { AuthButton } from './auth-button';
import { IdentityButton } from './identity-button';
import { useAuth } from './auth-provider';
import { useWallet } from './wallet-provider';
import { owlpayApi, type Bounty, type BountyStatus } from '@/lib/api';

type WorkspaceView = 'overview' | 'explore' | 'owned' | 'applications';
type ExploreStatus = 'ALL' | 'OPEN' | 'SUBMITTED' | 'VERIFYING' | 'PAID';

const statusLabels: Record<BountyStatus, string> = {
  DRAFT: 'Draft', OPEN: 'Open', ASSIGNED: 'Assigned', SUBMITTED: 'Submitted', VERIFYING: 'Verifying', READY_FOR_REVIEW: 'Ready for review',
  REVISION_REQUIRED: 'Needs revision', HUMAN_REVIEW: 'Human review', APPROVED: 'Approved',
  PAID: 'Paid', EXPIRED: 'Expired', REFUNDED: 'Refunded', CANCELLED: 'Cancelled'
};

const viewCopy: Record<WorkspaceView, { eyebrow: string; title: string; copy: string }> = {
  overview: { eyebrow: 'OwlPay workspace', title: 'Overview', copy: 'Choose an action or continue where you left off.' },
  explore: { eyebrow: 'Marketplace', title: 'Explore bounties', copy: 'Open work with clear criteria and visible rewards.' },
  owned: { eyebrow: 'Repository owner', title: 'My bounties', copy: 'Track work you created and funded.' },
  applications: { eyebrow: 'Developer', title: 'My applications', copy: 'Track your applications, assignments, and submitted work.' }
};

function repositoryMeta(repositoryUrl: string) {
  try {
    const [, owner = 'github', repository = 'repository'] = new URL(repositoryUrl).pathname.split('/');
    return { owner, fullName: `${owner}/${repository}`, avatarUrl: `https://github.com/${owner}.png?size=96` };
  } catch {
    return { owner: 'github', fullName: repositoryUrl, avatarUrl: 'https://github.com/github.png?size=96' };
  }
}

function remainingTime(deadline: string) {
  const days = Math.ceil((new Date(deadline).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return 'Ended';
  if (days === 0) return 'Ends today';
  if (days === 1) return '1 day left';
  return `${days} days left`;
}

export function Dashboard({ initialIntent }: { initialIntent?: 'create' | 'explore' }) {
  const reduceMotion = useReducedMotion();
  const { configured: authConfigured, user, githubLogin, signIn } = useAuth();
  const { address } = useWallet();
  const [view, setView] = useState<WorkspaceView>(initialIntent === 'explore' ? 'explore' : 'overview');
  const [creating, setCreating] = useState(initialIntent === 'create');
  const [selectedBounty, setSelectedBounty] = useState<Bounty | null>(null);
  const [exploreQuery, setExploreQuery] = useState('');
  const [exploreStatus, setExploreStatus] = useState<ExploreStatus>('ALL');
  const bounties = useQuery({ queryKey: ['bounties'], queryFn: owlpayApi.listBounties, retry: 1 });
  const myApplications = useQuery({ queryKey: ['my-applications', user?.id], queryFn: owlpayApi.listMyApplications, enabled: view === 'applications' && Boolean(user), retry: false });
  const network = useQuery({ queryKey: ['network'], queryFn: owlpayApi.network, refetchInterval: 30_000, retry: 1 });
  const items = useMemo(() => bounties.data?.items ?? [], [bounties.data?.items]);

  useEffect(() => {
    if (initialIntent) window.history.replaceState(null, '', '/app');
  }, [initialIntent]);

  const visibleItems = useMemo(() => {
    if (view === 'explore') {
      const query = exploreQuery.trim().toLowerCase();
      return items.filter((item) => item.status !== 'DRAFT')
        .filter((item) => exploreStatus === 'ALL' || item.status === exploreStatus)
        .filter((item) => !query || `${item.title} ${item.description} ${item.repositoryUrl}`.toLowerCase().includes(query));
    }
    if (view === 'owned') return address ? items.filter((item) => item.ownerAddress.toLowerCase() === address.toLowerCase()) : [];
    return items.slice(0, 6);
  }, [address, exploreQuery, exploreStatus, items, view]);

  const locked = items.filter((item) => !['PAID', 'REFUNDED', 'CANCELLED'].includes(item.status)).reduce((sum, item) => sum + Number(item.rewardAmount), 0);
  const active = items.filter((item) => ['OPEN', 'ASSIGNED', 'SUBMITTED', 'VERIFYING', 'READY_FOR_REVIEW', 'REVISION_REQUIRED'].includes(item.status)).length;
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
            ['applications', 'My applications']
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
            {view !== 'applications' && <button className="primaryButton appPrimary" onClick={() => setCreating(true)}>New bounty <span>＋</span></button>}
          </div>

          {view === 'overview' && (
            <>
              {authConfigured && !githubLogin && (
                <button className="connectionHint" onClick={signIn}><span className="statusDot offline" /><span>Connect GitHub to create or submit work.</span><strong>Connect</strong></button>
              )}

              <section className="quickActions" aria-label="Quick actions">
                <motion.button className="quickAction" whileHover={reduceMotion ? undefined : { y: -2 }} whileTap={{ scale: 0.99 }} onClick={() => setCreating(true)}>
                  <span className="quickActionIcon">＋</span><div><strong>Create bounty</strong><small>Fund repository work</small></div><ArrowUpRight />
                </motion.button>
                <motion.button className="quickAction" whileHover={reduceMotion ? undefined : { y: -2 }} whileTap={{ scale: 0.99 }} onClick={() => setView('explore')}>
                  <span className="quickActionIcon exploreIcon">⌕</span><div><strong>Explore bounties</strong><small>Find open work</small></div><ArrowUpRight />
                </motion.button>
              </section>

              <div className="compactStats" aria-label="Workspace status">
                <div><strong>{active}</strong><span>active</span></div>
                <i />
                <div><strong>{locked.toFixed(2)}</strong><span>USDC locked</span></div>
                <i />
                <div><span className={`statusDot ${network.data?.status.connected ? '' : 'offline'}`} /><strong>{network.data?.status.connected ? 'Online' : 'Checking'}</strong><span>network</span></div>
              </div>
            </>
          )}

          {view === 'applications' ? (
            <section className="applicationWorkspace">
              {!user ? (
                <div className="marketplaceEmpty emptyState"><h3>Connect GitHub to see your applications</h3><p>Your application history is tied to your verified GitHub identity.</p><button className="secondaryButton" onClick={signIn}>Connect GitHub</button></div>
              ) : myApplications.isLoading ? <div className="marketplaceLoading loadingRows"><i /><i /><i /></div> : myApplications.isError ? (
                <div className="marketplaceEmpty emptyState"><h3>Applications could not be loaded</h3><p>{myApplications.error.message}</p></div>
              ) : myApplications.data?.items.length === 0 ? (
                <div className="marketplaceEmpty"><EmptyView view={view} connected={Boolean(address)} onCreate={() => setCreating(true)} onExplore={() => setView('explore')} /></div>
              ) : (
                <div className="myApplicationList">{myApplications.data?.items.map(({ application, bounty }) => (
                  <button className="myApplicationCard" key={application.id} onClick={() => setSelectedBounty(bounty)}>
                    <span className={`applicationState state-${application.status.toLowerCase()}`}>{application.status}</span>
                    <div><strong>{bounty.title}</strong><span>{bounty.repositoryUrl.replace('https://github.com/', '')}</span><p>{application.message}</p></div>
                    <div className="applicationReward"><strong>{bounty.rewardAmount} USDC</strong><span>{statusLabels[bounty.status]}</span></div>
                    <ArrowUpRight />
                  </button>
                ))}</div>
              )}
            </section>
          ) : view === 'explore' ? (
            <section className="marketplace" aria-label="Public bounty marketplace">
              <div className="marketplaceToolbar">
                <label className="marketplaceSearch"><span>⌕</span><input value={exploreQuery} onChange={(event) => setExploreQuery(event.target.value)} placeholder="Search bounties or repositories" aria-label="Search bounties" /></label>
                <div className="marketplaceFilters" aria-label="Filter by status">
                  {(['ALL', 'OPEN', 'SUBMITTED', 'VERIFYING', 'PAID'] as ExploreStatus[]).map((status) => <button className={exploreStatus === status ? 'active' : ''} onClick={() => setExploreStatus(status)} key={status}>{status === 'ALL' ? 'All' : statusLabels[status]}</button>)}
                </div>
                <span className="marketplaceCount">{visibleItems.length} bounties</span>
              </div>
              {bounties.isLoading ? <div className="marketplaceLoading loadingRows"><i /><i /><i /></div> : bounties.isError ? (
                <div className="marketplaceEmpty emptyState"><h3>API is offline</h3><p>Start the backend on port 4000, then refresh this page.</p></div>
              ) : visibleItems.length === 0 ? (
                <div className="marketplaceEmpty"><EmptyView view={view} connected={Boolean(address)} onCreate={() => setCreating(true)} onExplore={() => setView('explore')} /></div>
              ) : (
                <div className="marketplaceGrid">{visibleItems.map((bounty) => {
                  const repository = repositoryMeta(bounty.repositoryUrl);
                  const applicants = bounty.applicantCount;
                  return (
                    <motion.button className="marketplaceCard" key={bounty.id} onClick={() => setSelectedBounty(bounty)} whileHover={reduceMotion ? undefined : { y: -3 }} whileTap={{ scale: 0.995 }}>
                      <div className="marketplaceCardTop">
                        <div className="marketplaceRepo"><span className="marketplaceAvatar" role="img" aria-label={`${repository.owner} GitHub avatar`} style={{ backgroundImage: `url(${repository.avatarUrl})` }}>{repository.owner.slice(0, 1).toUpperCase()}</span><strong>{repository.fullName}</strong></div>
                        <span className="marketplaceReward">{bounty.rewardAmount} USDC</span>
                      </div>
                      <div className="marketplaceCardBody"><h2>{bounty.title}</h2><p>{bounty.description}</p></div>
                      <div className="marketplaceTags"><span className={`statusBadge status-${bounty.status.toLowerCase()}`}>{statusLabels[bounty.status]}</span>{bounty.criteria.slice(0, 2).map((criterion) => <span key={criterion.id}>{criterion.method.replace('-', ' ')}</span>)}</div>
                      <div className="marketplaceCardFooter">
                        <div><span className="metaIcon"><Users /></span><strong>{applicants}</strong><span>{applicants === 1 ? 'applicant' : 'applicants'}</span></div>
                        <div><span className="metaIcon"><Calendar /></span><strong>{remainingTime(bounty.deadline)}</strong></div>
                        <ArrowUpRight />
                      </div>
                    </motion.button>
                  );
                })}</div>
              )}
            </section>
          ) : (
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
          )}
        </motion.section>
      </div>

      {creating && <CreateBounty onClose={() => setCreating(false)} />}
      {selectedBounty && <BountyDetail initialBounty={selectedBounty} onClose={() => setSelectedBounty(null)} />}
    </main>
  );
}

function EmptyView({ view, connected, onCreate, onExplore }: { view: WorkspaceView; connected: boolean; onCreate: () => void; onExplore: () => void }) {
  if (view === 'owned' && !connected) {
    return <div className="emptyState"><span className="emptyOwl"><OwlMark /></span><h3>Connect your wallet to continue</h3><p>OwlPay uses the connected address to find your funded bounties.</p></div>;
  }
  if (view === 'applications') return <div className="emptyState"><span className="emptyOwl"><OwlMark /></span><h3>No applications yet</h3><p>Explore an open bounty and send the maintainer a short application message.</p><button className="secondaryButton" onClick={onExplore}>Explore bounties</button></div>;
  if (view === 'explore') return <div className="emptyState"><span className="emptyOwl"><OwlMark /></span><h3>No open bounties yet</h3><p>The marketplace is quiet right now. You can create the first funded task.</p><button className="secondaryButton" onClick={onCreate}>Create a bounty</button></div>;
  return <div className="emptyState"><span className="emptyOwl"><OwlMark /></span><h3>No bounties yet</h3><p>Create the first testnet bounty and define evidence the Owl Agent can verify.</p><button className="secondaryButton" onClick={onCreate}>Create first bounty</button></div>;
}
