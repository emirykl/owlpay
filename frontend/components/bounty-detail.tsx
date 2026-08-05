'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { encodeFunctionData } from 'viem';
import type { Bounty, BountyApplication } from '@/lib/api';
import { owlpayApi } from '@/lib/api';
import { contractAddress, contractsReady, owlPayAbi } from '@/lib/contracts';
import { goatPublicClient, goatTestnet } from '@/lib/network';
import { ArrowUpRight, Check, GitHubMark, LinkMark, MetaMaskMark } from './icons';
import { useAuth } from './auth-provider';
import { useWallet } from './wallet-provider';
import { WalletButton } from './wallet-button';
import { IdentityButton } from './identity-button';

export function BountyDetail({ initialBounty, onClose }: { initialBounty: Bounty; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { address, sendTransaction } = useWallet();
  const { configured, user, githubLogin, signIn } = useAuth();
  const [success, setSuccess] = useState<string | null>(null);
  const [applicationMessage, setApplicationMessage] = useState('');
  const detail = useQuery({ queryKey: ['bounty', initialBounty.id], queryFn: () => owlpayApi.getBounty(initialBounty.id), initialData: initialBounty });
  const identity = useQuery({ queryKey: ['identity'], queryFn: owlpayApi.me, enabled: configured && Boolean(user), retry: false });
  const bounty = detail.data;
  const isOwner = Boolean(user && bounty.ownerUserId === user.id);
  const isAssignedDeveloper = Boolean(user && bounty.assignedDeveloperUserId === user.id);
  const identityLinked = Boolean(address && identity.data?.wallet.verified && identity.data.wallet.walletAddress?.toLowerCase() === address.toLowerCase());
  const applications = useQuery({ queryKey: ['bounty-applications', bounty.id], queryFn: () => owlpayApi.listBountyApplications(bounty.id), enabled: isOwner, retry: false });
  const myApplications = useQuery({ queryKey: ['my-applications', user?.id], queryFn: owlpayApi.listMyApplications, enabled: Boolean(user) && !isOwner, retry: false });
  const myApplication = myApplications.data?.items.find((item) => item.application.bountyId === bounty.id)?.application;

  const applyMutation = useMutation({
    mutationFn: () => {
      if (!address) throw new Error('Connect your wallet first.');
      return owlpayApi.applyToBounty(bounty.id, applicationMessage, address);
    },
    onSuccess: async () => {
      setSuccess('Application sent to the maintainer.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bounties'] }),
        queryClient.invalidateQueries({ queryKey: ['bounty', bounty.id] }),
        queryClient.invalidateQueries({ queryKey: ['my-applications', user?.id] })
      ]);
    }
  });
  const assignMutation = useMutation({
    mutationFn: async (application: BountyApplication) => {
      let assignmentTxHash: string | undefined;
      if (contractsReady && contractAddress && bounty.onchainId && /^\d+$/.test(bounty.onchainId)) {
        if (!address || address.toLowerCase() !== bounty.ownerAddress.toLowerCase()) {
          throw new Error('Connect the wallet that funded this bounty before assigning a developer.');
        }
        assignmentTxHash = await sendTransaction({
          to: contractAddress,
          data: encodeFunctionData({ abi: owlPayAbi, functionName: 'assignDeveloper', args: [BigInt(bounty.onchainId), application.developerAddress as `0x${string}`] })
        });
        await goatPublicClient.waitForTransactionReceipt({ hash: assignmentTxHash as `0x${string}` });
      }
      return owlpayApi.assignApplication(bounty.id, application.id, assignmentTxHash);
    },
    onSuccess: async (updated) => {
      queryClient.setQueryData(['bounty', bounty.id], updated);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['bounties'] }), queryClient.invalidateQueries({ queryKey: ['bounty-applications', bounty.id] })]);
    }
  });
  const submitMutation = useMutation({
    mutationFn: async ({ pullRequestUrl }: { pullRequestUrl: string }) => {
      if (!address) throw new Error('Connect your wallet first.');
      if (bounty.assignedDeveloperAddress?.toLowerCase() !== address.toLowerCase()) {
        throw new Error('Connect the payout wallet used in your accepted application.');
      }
      const prepared = await owlpayApi.prepareSubmission(bounty.id, pullRequestUrl, address);
      let submissionTxHash: string | undefined;
      if (contractsReady && contractAddress && bounty.onchainId && /^\d+$/.test(bounty.onchainId)) {
        submissionTxHash = await sendTransaction({
          to: contractAddress,
          data: encodeFunctionData({ abi: owlPayAbi, functionName: 'submitWork', args: [BigInt(bounty.onchainId), prepared.submissionHash] })
        });
        await goatPublicClient.waitForTransactionReceipt({ hash: submissionTxHash as `0x${string}` });
      }
      return owlpayApi.submitWork(bounty.id, pullRequestUrl, address, submissionTxHash);
    },
    onSuccess: async (result) => {
      setSuccess(`Commit ${result.evidence.headSha.slice(0, 8)} is queued for Owl Agent verification.`);
      queryClient.setQueryData(['bounty', bounty.id], result.bounty);
      await queryClient.invalidateQueries({ queryKey: ['bounties'] });
    }
  });
  const reviewMutation = useMutation({
    mutationFn: (action: 'approve' | 'revision') => action === 'approve' ? owlpayApi.approveBounty(bounty.id) : owlpayApi.requestBountyRevision(bounty.id),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['bounty', bounty.id], updated);
      await queryClient.invalidateQueries({ queryKey: ['bounties'] });
    }
  });

  function submitWork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    submitMutation.mutate({ pullRequestUrl: String(data.get('pullRequestUrl')) });
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
          <div><span>Applications</span><strong>{bounty.applicantCount}</strong></div>
          <div><span>Deadline</span><strong>{new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(bounty.deadline))}</strong></div>
        </div>

        <div className="detailSection">
          <div className="detailSectionTitle"><h3>Acceptance criteria</h3><span>{bounty.criteria.length} mandatory checks</span></div>
          <div className="criteriaList">{bounty.criteria.map((criterion) => <div key={criterion.id}><span className="criteriaIcon"><Check /></span><p><strong>{criterion.description}</strong><small>{criterion.method.replace('-', ' ')}</small></p></div>)}</div>
        </div>

        {isOwner && ['OPEN', 'ASSIGNED'].includes(bounty.status) && (
          <div className="detailSection">
            <div className="detailSectionTitle"><h3>Applications</h3><span>{applications.data?.items.length ?? 0} candidates</span></div>
            {applications.isLoading ? <div className="loadingRows"><i /><i /></div> : applications.data?.items.length === 0 ? <p className="inlineNotice">No applications yet.</p> : (
              <div className="candidateList">{applications.data?.items.map((application) => <article className="candidateCard" key={application.id}>
                <span className="candidateAvatar" style={application.developerGithubAvatarUrl ? { backgroundImage: `url(${application.developerGithubAvatarUrl})` } : undefined}>{application.developerGithubLogin.slice(0, 1).toUpperCase()}</span>
                <div><strong>@{application.developerGithubLogin}</strong><p>{application.message}</p><small>{application.developerAddress.slice(0, 7)}…{application.developerAddress.slice(-5)}</small></div>
                {application.status === 'PENDING' ? <button className="secondaryButton" onClick={() => assignMutation.mutate(application)} disabled={assignMutation.isPending || bounty.status !== 'OPEN'}>{assignMutation.isPending ? 'Assigning…' : 'Assign bounty'}</button> : <span className={`applicationState state-${application.status.toLowerCase()}`}>{application.status}</span>}
              </article>)}</div>
            )}
            {assignMutation.error && <p className="formError" role="alert">{assignMutation.error.message}</p>}
          </div>
        )}

        {bounty.status === 'OPEN' && !isOwner && (
          <div className="detailSection applicationSection">
            <div className="detailSectionTitle"><h3>Apply for this bounty</h3><span>Send a short note to the maintainer</span></div>
            {configured && !user ? <button className="secondaryButton providerAction" onClick={signIn}><GitHubMark />Connect GitHub</button> : !address ? (
              <div className="connectionGate providerGate"><span className="connectionProviderIcon metamaskConnectionIcon"><MetaMaskMark /></span><div><strong>Connect MetaMask</strong><p>Your verified wallet becomes the payout address if you are selected.</p></div><WalletButton /></div>
            ) : configured && !identityLinked ? (
              <div className="connectionGate providerGate"><span className="connectionProviderIcon linkConnectionIcon"><LinkMark /></span><div><strong>Link GitHub and wallet</strong><p>Sign one message before applying.</p></div><IdentityButton /></div>
            ) : myApplication ? (
              <div className="applicationSent"><span className={`applicationState state-${myApplication.status.toLowerCase()}`}>{myApplication.status}</span><div><strong>Application sent</strong><p>{myApplication.message}</p></div></div>
            ) : (
              <div className="applicationForm"><textarea value={applicationMessage} onChange={(event) => setApplicationMessage(event.target.value)} minLength={20} maxLength={600} rows={4} placeholder="Briefly explain your experience and how you would approach this bounty." /><div><small>{applicationMessage.length}/600 · minimum 20 characters</small><button className="primaryButton" onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending || applicationMessage.trim().length < 20}>{applyMutation.isPending ? 'Sending…' : 'Send application'}</button></div></div>
            )}
            {applyMutation.error && <p className="formError" role="alert">{applyMutation.error.message}</p>}
          </div>
        )}

        {bounty.assignedDeveloperGithubLogin && <div className="assignedNotice"><span className="statusDot" /><p><strong>Assigned to @{bounty.assignedDeveloperGithubLogin}</strong><small>Only the selected developer can submit work.</small></p></div>}

        {bounty.submission && <div className="submissionCard"><span>Submitted commit</span><strong>{bounty.submission.commitSha.slice(0, 10)}</strong><a href={bounty.submission.pullRequestUrl} target="_blank" rel="noreferrer">Open pull request <ArrowUpRight /></a></div>}

        {bounty.decision && <div className={`decisionCard decision-${bounty.decision.decision.toLowerCase()}`}><span>Owl Agent report · {Math.round(bounty.decision.confidence * 100)}%</span><h3>{bounty.decision.decision.replaceAll('_', ' ')}</h3><p>{bounty.decision.summary}</p>{bounty.decision.blockingIssues.map((issue) => <small key={issue}>{issue}</small>)}</div>}

        {isAssignedDeveloper && ['ASSIGNED', 'REVISION_REQUIRED'].includes(bounty.status) && (
          <div className="detailSection submissionSection">
            <div className="detailSectionTitle"><h3>{bounty.status === 'REVISION_REQUIRED' ? 'Submit revision' : 'Submit your work'}</h3><span>Signed in as @{githubLogin}</span></div>
            <form className="submissionForm" onSubmit={submitWork}><input name="pullRequestUrl" type="url" required placeholder="https://github.com/org/repository/pull/42" aria-label="Pull request URL" /><button className="primaryButton" disabled={submitMutation.isPending}>{submitMutation.isPending ? 'Verifying & signing…' : 'Send for verification'}</button></form>
            {submitMutation.error && <p className="formError" role="alert">{submitMutation.error.message}</p>}
          </div>
        )}

        {isOwner && bounty.status === 'READY_FOR_REVIEW' && (
          <div className="maintainerReview"><div><strong>Maintainer decision</strong><p>Review the Owl Agent report and the pull request before approving payment.</p></div><div><button className="secondaryButton" onClick={() => reviewMutation.mutate('revision')} disabled={reviewMutation.isPending}>Request revision</button><button className="primaryButton" onClick={() => reviewMutation.mutate('approve')} disabled={reviewMutation.isPending}>{reviewMutation.isPending ? 'Processing…' : 'Approve & release'}</button></div></div>
        )}
        {reviewMutation.error && <p className="formError" role="alert">{reviewMutation.error.message}</p>}
        {success && <p className="formSuccess" role="status">{success}</p>}

        <div className="detailFooter"><a href={bounty.repositoryUrl} target="_blank" rel="noreferrer">GitHub repository <ArrowUpRight /></a>{bounty.fundingTxHash && <a href={`${goatTestnet.blockExplorers.default.url}/tx/${bounty.fundingTxHash}`} target="_blank" rel="noreferrer">Funding transaction <ArrowUpRight /></a>}{bounty.payoutTxHash && <a href={`${goatTestnet.blockExplorers.default.url}/tx/${bounty.payoutTxHash}`} target="_blank" rel="noreferrer">Payout transaction <ArrowUpRight /></a>}</div>
      </section>
    </div>
  );
}
