'use client';

import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Calendar, GitHubMark, OwlMark, Users } from './icons';
import { WalletButton } from './wallet-button';
import { CreateBounty } from './create-bounty';
import { BountyDetail } from './bounty-detail';
import { AuthButton } from './auth-button';
import { IdentityButton } from './identity-button';
import { useAuth } from './auth-provider';
import { useWallet } from './wallet-provider';
import { owlpayApi, type Bounty, type BountyApplication, type BountyStatus } from '@/lib/api';
import { getBountyDeadlineState } from '@/lib/bounty-deadline';
import { bountyTokenSymbol } from '@/lib/bounty-token';

type WorkspaceView = 'explore' | 'owned' | 'applications';
type ExploreStatus = 'ALL' | BountyStatus;
type ExploreSort = 'RECENT' | 'REWARD_HIGH' | 'DEADLINE';

const exploreStatuses: ExploreStatus[] = ['ALL', 'OPEN', 'ASSIGNED', 'SUBMITTED', 'VERIFYING', 'READY_FOR_REVIEW', 'PAID'];
const LIVE_SYNC_INTERVAL = 4_000;

const statusLabels: Record<BountyStatus, string> = {
  DRAFT: 'Draft', OPEN: 'Open', ASSIGNED: 'Assigned', SUBMITTED: 'Submitted', VERIFYING: 'Verifying', READY_FOR_REVIEW: 'Ready for review',
  REVISION_REQUIRED: 'Needs revision', HUMAN_REVIEW: 'Human review', APPROVED: 'Approved',
  PAID: 'Paid', EXPIRED: 'Expired', REFUNDED: 'Refunded', CANCELLED: 'Cancelled'
};

const viewTitles: Record<WorkspaceView, string> = {
  explore: 'Explore bounties',
  owned: 'My bounties',
  applications: 'My applications'
};

function repositoryMeta(repositoryUrl: string) {
  try {
    const [, owner = 'github', repository = 'repository'] = new URL(repositoryUrl).pathname.split('/');
    return { owner, fullName: `${owner}/${repository}`, avatarUrl: `https://github.com/${owner}.png?size=96` };
  } catch {
    return { owner: 'github', fullName: repositoryUrl, avatarUrl: 'https://github.com/github.png?size=96' };
  }
}

export function Dashboard({ initialIntent, initialView }: { initialIntent?: 'create' | 'explore'; initialView?: WorkspaceView }) {
  const reduceMotion = useReducedMotion();
  const { user, signIn } = useAuth();
  const userId = user?.id;
  const { address } = useWallet();
  const [view, setView] = useState<WorkspaceView>(initialView ?? 'explore');
  const [creating, setCreating] = useState(initialIntent === 'create');
  const [selectedBounty, setSelectedBounty] = useState<Bounty | null>(null);
  const [exploreQuery, setExploreQuery] = useState('');
  const [exploreStatus, setExploreStatus] = useState<ExploreStatus>('ALL');
  const [exploreRepository, setExploreRepository] = useState('');
  const [exploreSort, setExploreSort] = useState<ExploreSort>('RECENT');
  const [now, setNow] = useState(() => Date.now());
  const bounties = useQuery({
    queryKey: ['bounties'],
    queryFn: owlpayApi.listBounties,
    refetchInterval: view !== 'applications' && !creating && !selectedBounty ? LIVE_SYNC_INTERVAL : false,
    refetchIntervalInBackground: false,
    retry: 1
  });
  const myApplications = useQuery({
    queryKey: ['my-applications', userId],
    queryFn: owlpayApi.listMyApplications,
    enabled: view === 'applications' && Boolean(userId),
    refetchInterval: !creating && !selectedBounty ? LIVE_SYNC_INTERVAL : false,
    refetchIntervalInBackground: false,
    retry: false
  });
  const network = useQuery({ queryKey: ['network'], queryFn: owlpayApi.network, refetchInterval: 30_000, retry: 1 });
  const items = useMemo(() => bounties.data?.items ?? [], [bounties.data?.items]);
  const publicItems = useMemo(() => items.filter((item) => item.status !== 'DRAFT'), [items]);
  const repositories = useMemo(() => Array.from(new Map(publicItems.map((item) => {
    const repository = repositoryMeta(item.repositoryUrl);
    return [item.repositoryUrl, repository.fullName] as const;
  })).entries()).sort((a, b) => a[1].localeCompare(b[1])), [publicItems]);

  useEffect(() => {
    if (initialIntent) window.history.replaceState(null, '', '/app');
  }, [initialIntent]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (view === 'explore') url.searchParams.delete('view');
    else url.searchParams.set('view', view);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }, [view]);

  const visibleItems = useMemo(() => {
    if (view === 'explore') {
      const query = exploreQuery.trim().toLowerCase();
      const repositoryQuery = exploreRepository.trim().toLowerCase();
      return publicItems
        .filter((item) => exploreStatus === 'ALL' || (item.status === exploreStatus && !(exploreStatus === 'OPEN' && getBountyDeadlineState(item.deadline, now).closed)))
        .filter((item) => !repositoryQuery || repositoryMeta(item.repositoryUrl).fullName.toLowerCase().includes(repositoryQuery))
        .filter((item) => !query || `${item.title} ${item.description} ${item.repositoryUrl}`.toLowerCase().includes(query))
        .sort((a, b) => {
          if (exploreSort === 'REWARD_HIGH') return Number(b.rewardAmount) - Number(a.rewardAmount);
          if (exploreSort === 'DEADLINE') return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
    }
    if (view === 'owned') return items.filter((item) => (
      Boolean(userId && item.ownerUserId === userId)
      || Boolean(address && item.ownerAddress.toLowerCase() === address.toLowerCase())
    ));
    return [];
  }, [address, exploreQuery, exploreRepository, exploreSort, exploreStatus, items, now, publicItems, userId, view]);

  const title = viewTitles[view];
  const rewardTokenSymbol = network.data?.paymentToken.symbol ?? 'USDC';

  return (
    <main className="workspaceShell">
      <aside className="appSidebar">
        <Link className="brand appBrand" href="/" aria-label="OwlPay landing page"><OwlMark className="brandMark" /><span>OwlPay</span></Link>
        <nav className="appNavigation" aria-label="Workspace navigation">
          {([
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
          <div className="appHeaderTitle"><strong>{title}</strong></div>
          <div className="appHeaderActions">
            {view !== 'applications' && <button className="headerNewBounty" onClick={() => setCreating(true)}>New bounty <span>＋</span></button>}
            <div className="appConnections"><AuthButton /><WalletButton /><IdentityButton /></div>
          </div>
        </header>

        <motion.section className={`workspaceContent exploreWorkspace ${view === 'owned' ? 'ownedWorkspace' : ''} ${view === 'applications' ? 'applicationsWorkspace' : ''}`} key={view} initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}>
          {view === 'applications' ? (
            <section className="applicationWorkspace">
              {!user ? (
                <div className="marketplaceEmpty emptyState"><h3>Connect GitHub to see your applications</h3><p>Your application history is tied to your verified GitHub identity.</p><button className="secondaryButton providerAction" onClick={signIn}><GitHubMark />Connect GitHub</button></div>
              ) : myApplications.isLoading ? <div className="marketplaceLoading loadingRows"><i /><i /><i /></div> : myApplications.isError ? (
                <div className="marketplaceEmpty emptyState"><h3>Applications could not be loaded</h3><p>{myApplications.error.message}</p></div>
              ) : myApplications.data?.items.length === 0 ? (
                <div className="marketplaceEmpty"><EmptyView view={view} connected={Boolean(address)} onCreate={() => setCreating(true)} onExplore={() => setView('explore')} /></div>
              ) : (
                <div className="myApplicationList">{myApplications.data?.items.map(({ application, bounty }) => (
                  <MyApplicationCard application={application} bounty={bounty} key={application.id} now={now} onOpen={() => setSelectedBounty(bounty)} reduceMotion={reduceMotion} currentTokenSymbol={rewardTokenSymbol} />
                ))}</div>
              )}
            </section>
          ) : view === 'explore' ? (
            <section className="marketplace" aria-label="Public bounty marketplace">
              <div className="marketplaceLayout">
                <div className="marketplaceResults">
                  {bounties.isLoading ? <div className="marketplaceLoading loadingRows"><i /><i /><i /></div> : bounties.isError ? (
                    <div className="marketplaceEmpty emptyState"><h3>API is offline</h3><p>Start the backend on port 4000, then refresh this page.</p></div>
                  ) : visibleItems.length === 0 ? (
                    <div className="marketplaceEmpty"><EmptyView view={view} connected={Boolean(address)} onCreate={() => setCreating(true)} onExplore={() => setView('explore')} /></div>
                  ) : (
                    <div className="marketplaceGrid">{visibleItems.map((bounty) => <MarketplaceBountyCard bounty={bounty} key={bounty.id} now={now} onOpen={() => setSelectedBounty(bounty)} reduceMotion={reduceMotion} currentTokenSymbol={rewardTokenSymbol} />)}</div>
                  )}
                </div>

                <aside className="marketplaceSidebar" aria-label="Bounty filters">
                  <div className="marketplaceTotal"><span>Total bounties</span><strong>{publicItems.length}</strong></div>
                  <div className="marketplaceFilterPanel">
                    <div className="filterPanelHeader"><span>Filters</span>{(exploreQuery || exploreStatus !== 'ALL' || exploreRepository || exploreSort !== 'RECENT') && <button onClick={() => { setExploreQuery(''); setExploreStatus('ALL'); setExploreRepository(''); setExploreSort('RECENT'); }}>Reset</button>}</div>
                    <label className="filterSearch"><span>⌕</span><input value={exploreQuery} onChange={(event) => setExploreQuery(event.target.value)} placeholder="Search by title" aria-label="Search bounties" /></label>
                    <i className="filterDivider" />
                    <label className="filterField"><span>Status</span><select value={exploreStatus} onChange={(event) => setExploreStatus(event.target.value as ExploreStatus)}>{exploreStatuses.map((status) => <option key={status} value={status}>{status === 'ALL' ? 'All statuses' : statusLabels[status]}</option>)}</select></label>
                    <label className="filterField"><span>Repository</span><input list="bounty-repositories" value={exploreRepository} onChange={(event) => setExploreRepository(event.target.value)} placeholder="All repositories" aria-label="Filter by repository" /><datalist id="bounty-repositories">{repositories.map(([url, name]) => <option key={url} value={name} />)}</datalist></label>
                    <label className="filterField"><span>Sort by</span><select value={exploreSort} onChange={(event) => setExploreSort(event.target.value as ExploreSort)}><option value="RECENT">Most recent</option><option value="REWARD_HIGH">Highest reward</option><option value="DEADLINE">Deadline soonest</option></select></label>
                  </div>
                </aside>
              </div>
            </section>
          ) : (
            <section className="ownedMarketplace" aria-label="Your bounties">
              {bounties.isLoading ? <div className="loadingRows"><i /><i /><i /></div> : bounties.isError ? (
                <div className="marketplaceEmpty emptyState"><h3>API is offline</h3><p>Start the backend on port 4000, then refresh this page.</p></div>
              ) : visibleItems.length === 0 ? (
                <div className="marketplaceEmpty"><EmptyView view={view} connected={Boolean(address)} onCreate={() => setCreating(true)} onExplore={() => setView('explore')} /></div>
              ) : (
                <div className="marketplaceGrid">{visibleItems.map((bounty) => <MarketplaceBountyCard bounty={bounty} key={bounty.id} now={now} onOpen={() => setSelectedBounty(bounty)} reduceMotion={reduceMotion} currentTokenSymbol={rewardTokenSymbol} />)}</div>
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

function MyApplicationCard({ application, bounty, now, onOpen, reduceMotion, currentTokenSymbol }: { application: BountyApplication; bounty: Bounty; now: number; onOpen: () => void; reduceMotion: boolean | null; currentTokenSymbol: string }) {
  const repository = repositoryMeta(bounty.repositoryUrl);
  const needsRevision = bounty.status === 'REVISION_REQUIRED';
  const latestRevisionRequest = bounty.revisionRequests?.at(-1);
  const awaitingMaintainer = ['SUBMITTED', 'READY_FOR_REVIEW', 'HUMAN_REVIEW'].includes(bounty.status);
  const activeDeadlineValue = needsRevision || bounty.status === 'ASSIGNED'
    ? bounty.contributorDeadline ?? bounty.deadline
    : awaitingMaintainer ? bounty.maintainerReviewDeadline ?? bounty.deadline : bounty.deadline;
  const deadline = getBountyDeadlineState(activeDeadlineValue, now);
  const deadlineTitle = needsRevision ? 'Revision due' : awaitingMaintainer ? 'Review by' : 'Deadline';

  return (
    <motion.button className={`myApplicationCard ${needsRevision ? 'revisionRequiredCard' : ''}`} onClick={onOpen} whileHover={reduceMotion ? undefined : { y: -3 }} whileTap={{ scale: .995 }}>
      <div className="myApplicationCardTop">
        <div className="marketplaceRepo">
          <span className="marketplaceAvatar" role="img" aria-label={`${repository.owner} GitHub avatar`} style={{ backgroundImage: `url(${repository.avatarUrl})` }}>{repository.owner.slice(0, 1).toUpperCase()}</span>
          <strong>{repository.fullName}</strong>
        </div>
        <span className={`applicationState ${needsRevision ? 'revisionApplicationState' : `state-${application.status.toLowerCase()}`}`}>{needsRevision ? 'Action required' : application.status}</span>
      </div>
      <div className="myApplicationCardBody"><h2>{bounty.title}</h2><p>{needsRevision && latestRevisionRequest ? latestRevisionRequest.message : application.message}</p></div>
      <div className="myApplicationCardFooter">
        <div><span>Reward</span><strong>{bounty.rewardAmount} {bountyTokenSymbol(bounty, currentTokenSymbol)}</strong></div>
        <div><span>Bounty</span><strong>{statusLabels[bounty.status]}</strong></div>
        <div><span>{deadlineTitle}</span><strong>{deadline.closed ? 'Deadline ended' : deadline.label}</strong></div>
        <ArrowUpRight />
      </div>
    </motion.button>
  );
}

function MarketplaceBountyCard({ bounty, now, onOpen, reduceMotion, currentTokenSymbol }: { bounty: Bounty; now: number; onOpen: () => void; reduceMotion: boolean | null; currentTokenSymbol: string }) {
  const repository = repositoryMeta(bounty.repositoryUrl);
  const applicants = bounty.applicantCount;
  const deadline = getBountyDeadlineState(bounty.deadline, now);
  const isClosed = bounty.status === 'OPEN' && deadline.closed;

  return (
    <motion.button className="marketplaceCard" onClick={onOpen} whileHover={reduceMotion ? undefined : { y: -3 }} whileTap={{ scale: 0.995 }}>
      <div className="marketplaceCardTop">
        <div className="marketplaceRepo"><span className="marketplaceAvatar" role="img" aria-label={`${repository.owner} GitHub avatar`} style={{ backgroundImage: `url(${repository.avatarUrl})` }}>{repository.owner.slice(0, 1).toUpperCase()}</span><strong>{repository.fullName}</strong></div>
        <div className="marketplaceCardPills"><span className={`statusBadge status-${isClosed ? 'closed' : bounty.status.toLowerCase()}`}>{isClosed ? 'Closed' : statusLabels[bounty.status]}</span><span className="marketplaceReward">{bounty.rewardAmount} {bountyTokenSymbol(bounty, currentTokenSymbol)}</span></div>
      </div>
      <div className="marketplaceCardBody"><h2>{bounty.title}</h2><p>{bounty.description}</p></div>
      <div className="marketplaceCardFooter">
        <div><span className="metaIcon"><Users /></span><strong>{applicants}</strong><span>{applicants === 1 ? 'applicant' : 'applicants'}</span></div>
        {!isClosed && <div><span className="metaIcon"><Calendar /></span><strong>{deadline.label}</strong></div>}
      </div>
    </motion.button>
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
