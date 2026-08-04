'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ArrowUpRight, Check, OwlMark } from './icons';
import { WalletButton } from './wallet-button';
import { CreateBounty } from './create-bounty';
import { BountyDetail } from './bounty-detail';
import { AuthButton } from './auth-button';
import { IdentityButton } from './identity-button';
import { owlpayApi, type Bounty, type BountyStatus } from '@/lib/api';

const statusLabels: Record<BountyStatus, string> = {
  DRAFT: 'Draft', OPEN: 'Open', SUBMITTED: 'Submitted', VERIFYING: 'Verifying',
  REVISION_REQUIRED: 'Needs revision', HUMAN_REVIEW: 'Human review', APPROVED: 'Approved',
  PAID: 'Paid', EXPIRED: 'Expired', REFUNDED: 'Refunded', CANCELLED: 'Cancelled'
};

export function Dashboard() {
  const [creating, setCreating] = useState(false);
  const [selectedBounty, setSelectedBounty] = useState<Bounty | null>(null);
  const bounties = useQuery({ queryKey: ['bounties'], queryFn: owlpayApi.listBounties, retry: 1 });
  const network = useQuery({ queryKey: ['network'], queryFn: owlpayApi.network, refetchInterval: 30_000, retry: 1 });
  const items = bounties.data?.items ?? [];
  const locked = items.filter((item) => !['PAID', 'REFUNDED', 'CANCELLED'].includes(item.status)).reduce((sum, item) => sum + Number(item.rewardAmount), 0);

  return (
    <main>
      <nav className="nav shell" aria-label="Main navigation">
        <a className="brand" href="#top" aria-label="OwlPay home"><OwlMark className="brandMark" /><span>OwlPay</span></a>
        <div className="navMeta">
          <span className="networkPill"><span className={`statusDot ${network.data?.status.connected ? '' : 'offline'}`} />GOAT Testnet3</span>
          <AuthButton />
          <WalletButton />
          <IdentityButton />
        </div>
      </nav>

      <section id="top" className="hero shell">
        <div className="heroCopy">
          <span className="eyebrow">Evidence-based settlement</span>
          <h1>Great work deserves<br /><span>certain payment.</span></h1>
          <p>Fund a GitHub bounty, let the Owl Agent inspect every requirement, and release payment only when the evidence passes.</p>
          <div className="heroActions"><button className="primaryButton large" onClick={() => setCreating(true)}>Create a bounty <ArrowUpRight /></button><a className="textLink" href="#how">See how it works</a></div>
        </div>
        <div className="agentCard" aria-label="Owl Agent verification preview">
          <div className="agentTop"><div><span className="miniLabel">OWL AGENT · LIVE</span><h2>Verification complete</h2></div><div className="score">94<span>%</span></div></div>
          <div className="divider" />
          <div className="checkList">
            <div><span className="checkIcon"><Check /></span><p><strong>Endpoint response</strong><small>HTTP 200 · evidence attached</small></p></div>
            <div><span className="checkIcon"><Check /></span><p><strong>Test suite</strong><small>42 checks passed</small></p></div>
            <div><span className="checkIcon"><Check /></span><p><strong>Commit integrity</strong><small>Bound to 8f2c…91ad</small></p></div>
          </div>
          <div className="settlementBar"><span>Ready to settle</span><strong>20.00 USDC</strong></div>
        </div>
      </section>

      <section className="dashboard shell" aria-labelledby="dashboard-title">
        <div className="sectionHeading"><div><span className="eyebrow">Testnet workspace</span><h2 id="dashboard-title">Bounty overview</h2></div><button className="secondaryButton" onClick={() => setCreating(true)}>New bounty</button></div>
        <div className="metrics">
          <article><span>Locked rewards</span><strong>{locked.toFixed(2)} <small>USDC</small></strong><p>Across active bounties</p></article>
          <article><span>Active bounties</span><strong>{items.filter((item) => ['OPEN', 'SUBMITTED', 'VERIFYING'].includes(item.status)).length}</strong><p>Awaiting verified work</p></article>
          <article><span>Network</span><strong className="networkMetric">{network.data?.status.connected ? 'Connected' : 'Checking'}</strong><p>{network.data?.status.blockNumber ? `Block ${network.data.status.blockNumber}` : 'GOAT Testnet3'}</p></article>
        </div>

        <div className="bountyPanel">
          <div className="panelHeader"><h3>Recent bounties</h3><span>{items.length} total</span></div>
          {bounties.isLoading ? <div className="loadingRows"><i /><i /><i /></div> : bounties.isError ? (
            <div className="emptyState"><h3>API is offline</h3><p>Start the backend on port 4000, then refresh this page.</p></div>
          ) : items.length === 0 ? (
            <div className="emptyState"><span className="emptyOwl"><OwlMark /></span><h3>No bounties yet</h3><p>Create the first testnet draft and define evidence the Owl Agent can verify.</p><button className="secondaryButton" onClick={() => setCreating(true)}>Create first bounty</button></div>
          ) : (
            <div className="bountyList">{items.map((bounty) => (
              <article className="bountyRow" key={bounty.id}>
                <div className="repoGlyph">{bounty.title.slice(0, 1).toUpperCase()}</div>
                <div className="bountyName"><strong>{bounty.title}</strong><span>{bounty.repositoryUrl.replace('https://github.com/', '')}</span></div>
                <span className={`statusBadge status-${bounty.status.toLowerCase()}`}>{statusLabels[bounty.status]}</span>
                <div className="reward"><strong>{bounty.rewardAmount} USDC</strong><span>{bounty.criteria.length} criterion</span></div>
                <button className="rowLink" onClick={() => setSelectedBounty(bounty)} aria-label={`Open ${bounty.title} details`}><ArrowUpRight /></button>
              </article>
            ))}</div>
          )}
        </div>
      </section>

      <section id="how" className="how shell">
        <div className="sectionHeading"><div><span className="eyebrow">Simple by design</span><h2>From funded task to<br />verified settlement.</h2></div></div>
        <div className="steps">
          <article><span>01</span><h3>Lock the reward</h3><p>The owner defines measurable criteria and funds the escrow on GOAT Testnet3.</p></article>
          <article><span>02</span><h3>Inspect the evidence</h3><p>The Owl Agent checks the exact commit, CI results, code changes and paid reports.</p></article>
          <article><span>03</span><h3>Release with certainty</h3><p>Only a complete, high-confidence decision can unlock payment to the registered developer.</p></article>
        </div>
      </section>

      <footer className="footer shell"><a className="brand" href="#top"><OwlMark className="brandMark" /><span>OwlPay</span></a><p>Inspect the work. Release the payment.</p><a href="https://explorer.testnet3.goat.network" target="_blank" rel="noreferrer">Testnet explorer <ArrowUpRight /></a></footer>
      {creating && <CreateBounty onClose={() => setCreating(false)} />}
      {selectedBounty && <BountyDetail initialBounty={selectedBounty} onClose={() => setSelectedBounty(null)} />}
    </main>
  );
}
