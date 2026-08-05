'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { Bounty } from '@/lib/api';
import { owlpayApi } from '@/lib/api';
import { goatTestnet } from '@/lib/network';
import { ArrowUpRight, Check } from './icons';
import { useAuth } from './auth-provider';
import { useWallet } from './wallet-provider';
import { WalletButton } from './wallet-button';
import { IdentityButton } from './identity-button';

export function BountyDetail({ initialBounty, onClose }: { initialBounty: Bounty; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { address } = useWallet();
  const { configured, user, githubLogin, signIn } = useAuth();
  const [success, setSuccess] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ['bounty', initialBounty.id],
    queryFn: () => owlpayApi.getBounty(initialBounty.id),
    initialData: initialBounty
  });
  const identity = useQuery({
    queryKey: ['identity'],
    queryFn: owlpayApi.me,
    enabled: configured && Boolean(user),
    retry: false
  });
  const bounty = detail.data;
  const canSubmit = ['OPEN', 'REVISION_REQUIRED'].includes(bounty.status);
  const identityLinked = Boolean(address
    && identity.data?.wallet.verified
    && identity.data.wallet.walletAddress?.toLowerCase() === address.toLowerCase());
  const mutation = useMutation({
    mutationFn: ({ pullRequestUrl }: { pullRequestUrl: string }) => {
      if (!address) throw new Error('Connect your wallet first.');
      return owlpayApi.submitWork(bounty.id, pullRequestUrl, address);
    },
    onSuccess: async (result) => {
      setSuccess(`Commit ${result.evidence.headSha.slice(0, 8)} is now queued for verification.`);
      queryClient.setQueryData(['bounty', bounty.id], result.bounty);
      await queryClient.invalidateQueries({ queryKey: ['bounties'] });
    }
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    mutation.mutate({ pullRequestUrl: String(data.get('pullRequestUrl')) });
  }

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal detailModal" role="dialog" aria-modal="true" aria-labelledby="bounty-title">
        <div className="modalHeader detailHeader">
          <div><span className="eyebrow">{bounty.status.replaceAll('_', ' ')}</span><h2 id="bounty-title">{bounty.title}</h2><p>{bounty.description}</p></div>
          <button className="iconButton" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="detailStats">
          <div><span>Reward</span><strong>{bounty.rewardAmount} USDC</strong></div>
          <div><span>Verification cap</span><strong>{bounty.verificationBudget} USDC</strong></div>
          <div><span>Deadline</span><strong>{new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(bounty.deadline))}</strong></div>
        </div>

        <div className="detailSection">
          <div className="detailSectionTitle"><h3>Acceptance criteria</h3><span>{bounty.criteria.length} mandatory checks</span></div>
          <div className="criteriaList">{bounty.criteria.map((criterion) => (
            <div key={criterion.id}><span className="criteriaIcon"><Check /></span><p><strong>{criterion.description}</strong><small>{criterion.method.replace('-', ' ')}</small></p></div>
          ))}</div>
        </div>

        {bounty.submission && (
          <div className="submissionCard">
            <span>Submitted commit</span><strong>{bounty.submission.commitSha.slice(0, 10)}</strong>
            <a href={bounty.submission.pullRequestUrl} target="_blank" rel="noreferrer">Open pull request <ArrowUpRight /></a>
          </div>
        )}

        {bounty.decision && (
          <div className={`decisionCard decision-${bounty.decision.decision.toLowerCase()}`}>
            <span>Owl Agent decision · {Math.round(bounty.decision.confidence * 100)}%</span>
            <h3>{bounty.decision.decision.replaceAll('_', ' ')}</h3>
            <p>{bounty.decision.summary}</p>
            {bounty.decision.blockingIssues.map((issue) => <small key={issue}>{issue}</small>)}
          </div>
        )}

        {canSubmit && (
          <div className="detailSection submissionSection">
            <div className="detailSectionTitle"><h3>{bounty.status === 'REVISION_REQUIRED' ? 'Submit revision' : 'Submit your work'}</h3><span>{githubLogin ? `Signed in as @${githubLogin}` : 'GitHub identity required'}</span></div>
            {configured && !user ? (
              <button className="secondaryButton" onClick={signIn}>Connect GitHub</button>
            ) : !address ? (
              <div className="connectionGate"><div><strong>Connect MetaMask</strong><p>Your verified wallet receives the reward if the work is approved.</p></div><WalletButton /></div>
            ) : configured && !identityLinked ? (
              <div className="connectionGate"><div><strong>Link GitHub and wallet</strong><p>Sign one message to prove the pull request and payout address belong to you.</p></div><IdentityButton /></div>
            ) : (
              <form className="submissionForm" onSubmit={submit}>
                <input name="pullRequestUrl" type="url" required placeholder="https://github.com/org/repository/pull/42" aria-label="Pull request URL" />
                <button className="primaryButton" disabled={mutation.isPending}>{mutation.isPending ? 'Checking PR…' : 'Send for verification'}</button>
              </form>
            )}
            {mutation.error && <p className="formError" role="alert">{mutation.error.message}</p>}
            {success && <p className="formSuccess" role="status">{success}</p>}
          </div>
        )}

        <div className="detailFooter">
          <a href={bounty.repositoryUrl} target="_blank" rel="noreferrer">GitHub repository <ArrowUpRight /></a>
          {bounty.fundingTxHash && <a href={`${goatTestnet.blockExplorers.default.url}/tx/${bounty.fundingTxHash}`} target="_blank" rel="noreferrer">Funding transaction <ArrowUpRight /></a>}
        </div>
      </section>
    </div>
  );
}
