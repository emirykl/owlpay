'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
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
import { getBountyDeadlineState } from '@/lib/bounty-deadline';
import { getTransactionErrorMessage } from '@/lib/transaction-error';

const LIVE_SYNC_INTERVAL = 4_000;

export function BountyDetail({ initialBounty, onClose }: { initialBounty: Bounty; onClose: () => void }) {
  const reduceMotion = useReducedMotion();
  const queryClient = useQueryClient();
  const { address, sendTransaction, payGoatFlowOrder } = useWallet();
  const { configured, user, githubLogin, signIn } = useAuth();
  const [success, setSuccess] = useState<string | null>(null);
  const [applicationMessage, setApplicationMessage] = useState('');
  const [reviewInfo, setReviewInfo] = useState<'STANDARD' | 'SECURITY' | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [revisionComposerOpen, setRevisionComposerOpen] = useState(false);
  const [revisionMessage, setRevisionMessage] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const detail = useQuery({ queryKey: ['bounty', initialBounty.id], queryFn: () => owlpayApi.getBounty(initialBounty.id), initialData: initialBounty, refetchInterval: LIVE_SYNC_INTERVAL, refetchIntervalInBackground: false });
  const identity = useQuery({ queryKey: ['identity'], queryFn: owlpayApi.me, enabled: configured && Boolean(user), retry: false });
  const bounty = detail.data;
  const isOwner = Boolean(user && bounty.ownerUserId === user.id);
  const isAssignedDeveloper = Boolean(user && bounty.assignedDeveloperUserId === user.id);
  const identityLinked = Boolean(address && identity.data?.wallet.verified && identity.data.wallet.walletAddress?.toLowerCase() === address.toLowerCase());
  const applications = useQuery({ queryKey: ['bounty-applications', bounty.id], queryFn: () => owlpayApi.listBountyApplications(bounty.id), enabled: isOwner, refetchInterval: LIVE_SYNC_INTERVAL, refetchIntervalInBackground: false, retry: false });
  const myApplications = useQuery({ queryKey: ['my-applications', user?.id], queryFn: owlpayApi.listMyApplications, enabled: Boolean(user) && !isOwner, refetchInterval: LIVE_SYNC_INTERVAL, refetchIntervalInBackground: false, retry: false });
  const myApplication = myApplications.data?.items.find((item) => item.application.bountyId === bounty.id)?.application;
  const network = useQuery({ queryKey: ['network'], queryFn: owlpayApi.network, retry: false });
  const deadline = getBountyDeadlineState(bounty.deadline, now);
  const isClosed = bounty.status === 'OPEN' && deadline.closed;
  const platformFeeRate = (network.data?.platformFeeBps ?? 300) / 10_000;
  const estimatedPayout = Math.max(0, Number(bounty.rewardAmount) * (1 - platformFeeRate));
  const deadlineLabel = isClosed
    ? `Ended ${new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(bounty.deadline))}`
    : deadline.label;
  const repository = getRepositoryIdentity(bounty.repositoryUrl);
  const standardPrice = Number(network.data?.reviewPrices.standard ?? 1);
  const securityPrice = Number(network.data?.reviewPrices.security ?? 2);
  const reviewTokenSymbol = network.data?.reviewPaymentToken.symbol ?? 'USDC';
  const paidReviewAmount = Number(bounty.reviewPaidAmount ?? (bounty.reviewPaymentStatus === 'PAID' ? bounty.reviewPrice : 0));
  const securityActive = bounty.reviewPlan === 'SECURITY' && paidReviewAmount >= securityPrice && ['PAID', 'CONSUMED'].includes(bounty.reviewPaymentStatus);
  const standardActive = !securityActive && bounty.reviewPlan === 'STANDARD' && paidReviewAmount >= standardPrice && ['PAID', 'CONSUMED'].includes(bounty.reviewPaymentStatus);
  const canUpgradeReview = isOwner && bounty.reviewPaymentStatus !== 'CONSUMED' && !['PAID', 'REFUNDED', 'CANCELLED'].includes(bounty.status);
  const latestRevisionRequest = bounty.revisionRequests?.at(-1);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!reviewInfo && !reportOpen && !revisionComposerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setReviewInfo(null);
      setReportOpen(false);
      setRevisionComposerOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [reportOpen, reviewInfo, revisionComposerOpen]);

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
      setSuccess(bounty.status === 'REVISION_REQUIRED'
        ? `Revision ${result.evidence.headSha.slice(0, 8)} submitted. The maintainer will review the updated pull request.`
        : bounty.reviewPlan === 'NONE'
        ? `Commit ${result.evidence.headSha.slice(0, 8)} submitted. The maintainer will review the pull request manually.`
        : bounty.reviewPaymentStatus === 'PAID'
        ? bounty.reviewPlan === 'SECURITY'
          ? `Commit ${result.evidence.headSha.slice(0, 8)} submitted. The ${securityPrice} ${reviewTokenSymbol} Owl Security AI review performs deeper code and security analysis before the maintainer makes the final decision.`
          : `Commit ${result.evidence.headSha.slice(0, 8)} submitted. The ${standardPrice} ${reviewTokenSymbol} Owl AI review analyzes the pull request before the maintainer makes the final decision.`
        : `Commit ${result.evidence.headSha.slice(0, 8)} submitted. The maintainer must activate a review package before AI analysis can run.`);
      queryClient.setQueryData(['bounty', bounty.id], result.bounty);
      await queryClient.invalidateQueries({ queryKey: ['bounties'] });
    }
  });
  const purchaseReviewMutation = useMutation({
    mutationFn: async (targetPlan: 'STANDARD' | 'SECURITY') => {
      if (!address || address.toLowerCase() !== bounty.ownerAddress.toLowerCase()) {
        throw new Error('Connect the wallet that created this bounty.');
      }
      const order = await owlpayApi.requestReviewPayment(bounty.id, targetPlan);
      const txHash = order.clientTxHash as `0x${string}` | undefined ?? await payGoatFlowOrder(order);
      return owlpayApi.confirmReviewPayment(bounty.id, order.orderId, txHash);
    },
    onSuccess: async (updated) => {
      setSuccess(`${updated.reviewPlan === 'SECURITY' ? 'Security' : 'Standard'} review is active.`);
      queryClient.setQueryData(['bounty', bounty.id], updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bounties'] }),
        queryClient.invalidateQueries({ queryKey: ['bounty', bounty.id] })
      ]);
    }
  });
  const agentReviewMutation = useMutation({
    mutationFn: () => owlpayApi.runReview(bounty.id),
    onSuccess: async (updated) => {
      setSuccess('Owl Agent report is ready for your decision.');
      queryClient.setQueryData(['bounty', bounty.id], updated);
      await queryClient.invalidateQueries({ queryKey: ['bounties'] });
    }
  });
  const reviewMutation = useMutation({
    mutationFn: (action: { type: 'approve' } | { type: 'revision'; message: string }) => action.type === 'approve'
      ? owlpayApi.approveBounty(bounty.id)
      : owlpayApi.requestBountyRevision(bounty.id, action.message),
    onSuccess: async (updated, action) => {
      if (action.type === 'revision') {
        setRevisionComposerOpen(false);
        setRevisionMessage('');
        setSuccess('Revision request sent to the assigned developer.');
      }
      queryClient.setQueryData(['bounty', bounty.id], updated);
      await queryClient.invalidateQueries({ queryKey: ['bounties'] });
    }
  });

  function submitWork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    submitMutation.mutate({ pullRequestUrl: String(data.get('pullRequestUrl')) });
  }

  const assignErrorMessage = getTransactionErrorMessage(assignMutation.error, 'The assignment transaction could not be completed. Please try again.');
  const purchaseReviewErrorMessage = getTransactionErrorMessage(purchaseReviewMutation.error, 'The review payment could not be completed. Please try again.');
  const submitErrorMessage = getTransactionErrorMessage(submitMutation.error, 'The submission transaction could not be completed. Please try again.');

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal detailModal" role="dialog" aria-modal="true" aria-labelledby="bounty-title">
        <div className="detailTopbar">
          <span className={`detailStatusBadge detailStatus-${isClosed ? 'closed' : bounty.status.toLowerCase()}`}>{isClosed ? 'CLOSED' : bounty.status.replaceAll('_', ' ')}</span>
          <button className="iconButton" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="detailOverviewCard">
          <div className="detailHeader">
            <a className="detailRepository" href={bounty.repositoryUrl} target="_blank" rel="noreferrer">
              <span className="detailRepositoryAvatar" style={{ backgroundImage: `url(${repository.avatarUrl})` }} />
              <strong>{repository.fullName}</strong>
              <ArrowUpRight />
            </a>
            <h2 id="bounty-title">{bounty.title}</h2>
            <p>{bounty.description}</p>
          </div>
          <dl className="detailStats">
            <div><dt>Reward</dt><dd>{bounty.rewardAmount} otUSDC</dd></div>
            {!isClosed && <div><dt>Applications</dt><dd>{bounty.applicantCount}</dd></div>}
            <div><dt>Deadline</dt><dd>{deadlineLabel}</dd></div>
          </dl>
        </div>

        <div className="detailSection detailCardSection criteriaSection">
          <div className="detailSectionTitle"><h3>Acceptance criteria</h3></div>
          <div className="criteriaList">{bounty.criteria.map((criterion) => <div key={criterion.id}><span className="criteriaIcon"><Check /></span><p><strong>{criterion.description}</strong></p></div>)}</div>
        </div>

        {isOwner && !isClosed && ['OPEN', 'ASSIGNED'].includes(bounty.status) && (
          <div className="detailSection detailCardSection applicationsSection">
            <div className="detailSectionTitle"><h3>Applications</h3><span className="sectionCount">{applications.data?.items.length ?? 0}</span></div>
            {applications.isLoading ? <div className="loadingRows"><i /><i /></div> : applications.data?.items.length === 0 ? <p className="inlineNotice applicationEmpty">No applications yet.</p> : (
              <div className="candidateList">{applications.data?.items.map((application) => <article className="candidateCard" key={application.id}>
                <span className="candidateAvatar" style={application.developerGithubAvatarUrl ? { backgroundImage: `url(${application.developerGithubAvatarUrl})` } : undefined}>{application.developerGithubLogin.slice(0, 1).toUpperCase()}</span>
                <div><strong>@{application.developerGithubLogin}</strong><p>{application.message}</p><small>{application.developerAddress.slice(0, 7)}…{application.developerAddress.slice(-5)}</small></div>
                {application.status === 'PENDING' ? <button className="secondaryButton" onClick={() => assignMutation.mutate(application)} disabled={assignMutation.isPending || bounty.status !== 'OPEN'}>{assignMutation.isPending ? 'Assigning…' : 'Assign bounty'}</button> : <span className={`applicationState state-${application.status.toLowerCase()}`}>{application.status}</span>}
              </article>)}</div>
            )}
            {assignErrorMessage && <p className="formError" role="alert">{assignErrorMessage}</p>}
          </div>
        )}

        {bounty.status === 'OPEN' && !isOwner && !isClosed && (
          <div className="detailSection detailCardSection applicationSection">
            <div className="detailSectionTitle"><h3>Apply for this bounty</h3></div>
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

        {bounty.assignedDeveloperGithubLogin && (
          <div className="assignedNotice">
            <a className="assignedIdentity" href={`https://github.com/${bounty.assignedDeveloperGithubLogin}`} target="_blank" rel="noreferrer">
              <span className="assignedAvatar" style={{ backgroundImage: `url(https://github.com/${encodeURIComponent(bounty.assignedDeveloperGithubLogin)}.png?size=128)` }} />
              <span><small>Assigned developer</small><strong>@{bounty.assignedDeveloperGithubLogin}</strong></span>
              <ArrowUpRight />
            </a>
            <span className="assignedMeta">{isAssignedDeveloper
              ? `Estimated payout ${estimatedPayout.toFixed(2)} otUSDC · ${(platformFeeRate * 100).toFixed(0)}% fee`
              : bounty.assignedDeveloperAddress ? `${bounty.assignedDeveloperAddress.slice(0, 8)}…${bounty.assignedDeveloperAddress.slice(-6)}` : 'Verified GitHub developer'}</span>
          </div>
        )}

        {bounty.submission && <div className="submissionCard"><span>Submitted commit</span><strong>{bounty.submission.commitSha.slice(0, 10)}</strong><a href={bounty.submission.pullRequestUrl} target="_blank" rel="noreferrer">Open pull request <ArrowUpRight /></a></div>}

        {canUpgradeReview && !securityActive && (
          <div className="reviewUpgradeSection">
            <div className="reviewUpgradeHeading"><h3>AI Review</h3>{standardActive && <span>Standard active</span>}</div>
            <div className="reviewUpgradeGrid">
              <motion.article className={`reviewPackageCard standardPackageCard ${standardActive ? 'active' : ''}`} whileHover={reduceMotion || standardActive ? undefined : { y: -3 }} transition={{ type: 'spring', stiffness: 360, damping: 28 }}>
                <button type="button" className="reviewPackageAction" onClick={() => purchaseReviewMutation.mutate('STANDARD')} disabled={purchaseReviewMutation.isPending || standardActive}>
                  <span className="reviewPackageLogo"><ReviewOwlLogo tone="standard" /></span>
                  <span className="reviewPackageCopy"><strong>Standard review</strong></span>
                  <span className="reviewPackagePrice">{standardActive ? 'Active' : `${Math.max(0, standardPrice - paidReviewAmount)} ${reviewTokenSymbol}`}</span>
                </button>
                <button type="button" className="reviewPackageInfoButton" aria-label="Show Standard review details" aria-haspopup="dialog" aria-expanded={reviewInfo === 'STANDARD'} onClick={() => setReviewInfo('STANDARD')}>?</button>
              </motion.article>
              <motion.article className="reviewPackageCard securityPackageCard" whileHover={reduceMotion ? undefined : { y: -3 }} transition={{ type: 'spring', stiffness: 360, damping: 28 }}>
                <button type="button" className="reviewPackageAction" onClick={() => purchaseReviewMutation.mutate('SECURITY')} disabled={purchaseReviewMutation.isPending}>
                  <span className="reviewPackageLogo"><ReviewOwlLogo tone="security" /></span>
                  <span className="reviewPackageCopy"><strong>Security review</strong></span>
                  <span className="reviewPackagePrice">{Math.max(0, securityPrice - paidReviewAmount)} ${reviewTokenSymbol}</span>
                </button>
                <button type="button" className="reviewPackageInfoButton" aria-label="Show Security review details" aria-haspopup="dialog" aria-expanded={reviewInfo === 'SECURITY'} onClick={() => setReviewInfo('SECURITY')}>?</button>
              </motion.article>
            </div>
            {standardActive && bounty.status === 'SUBMITTED' && <div className="reviewUpgradeFooter"><button className="secondaryButton" onClick={() => agentReviewMutation.mutate()} disabled={agentReviewMutation.isPending}>{agentReviewMutation.isPending ? 'Analyzing…' : 'Run Standard review'}</button></div>}
          </div>
        )}
        {isOwner && securityActive && bounty.reviewPaymentStatus === 'PAID' && (
          <div className="reviewUpgradeSection activeReviewSection"><div className="reviewUpgradeHeading"><h3>AI Review</h3></div><div className="activeReviewPlan securityActivePlan"><span className="reviewPackageLogo"><ReviewOwlLogo tone="security" /></span><div><small>ACTIVE</small><strong>Security review</strong></div>{bounty.status === 'SUBMITTED' && <button className="primaryButton" onClick={() => agentReviewMutation.mutate()} disabled={agentReviewMutation.isPending}>{agentReviewMutation.isPending ? 'Analyzing…' : 'Run review'}</button>}</div></div>
        )}
        {isOwner && standardActive && !canUpgradeReview && bounty.reviewPaymentStatus === 'PAID' && (
          <div className="reviewUpgradeSection activeReviewSection"><div className="reviewUpgradeHeading"><h3>AI Review</h3></div><div className="activeReviewPlan standardActivePlan"><span className="reviewPackageLogo"><ReviewOwlLogo tone="standard" /></span><div><small>ACTIVE</small><strong>Standard review</strong></div>{bounty.status === 'SUBMITTED' && <button className="primaryButton" onClick={() => agentReviewMutation.mutate()} disabled={agentReviewMutation.isPending}>{agentReviewMutation.isPending ? 'Analyzing…' : 'Run review'}</button>}</div></div>
        )}
        {purchaseReviewErrorMessage && <p className="formError" role="alert">{purchaseReviewErrorMessage}</p>}
        {agentReviewMutation.error && <p className="formError" role="alert">{agentReviewMutation.error.message}</p>}

        {bounty.decision && <AgentReportCard decision={bounty.decision} onOpen={() => setReportOpen(true)} />}

        {bounty.status === 'REVISION_REQUIRED' && latestRevisionRequest && (isAssignedDeveloper || isOwner) && (
          <article className="revisionFeedbackCard">
            <div className="revisionFeedbackHeader">
              <span>Revision requested</span>
              <time dateTime={latestRevisionRequest.requestedAt}>{new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(latestRevisionRequest.requestedAt))}</time>
            </div>
            <p>{latestRevisionRequest.message}</p>
            <small>Requested for commit {latestRevisionRequest.commitSha.slice(0, 8)}</small>
          </article>
        )}

        {isAssignedDeveloper && ['ASSIGNED', 'REVISION_REQUIRED'].includes(bounty.status) && (
          <div className="detailSection submissionSection">
            <div className="detailSectionTitle"><h3>{bounty.status === 'REVISION_REQUIRED' ? 'Submit revision' : 'Submit your work'}</h3><span>Signed in as @{githubLogin}</span></div>
            <form className="submissionForm" onSubmit={submitWork}><input name="pullRequestUrl" type="url" required placeholder="https://github.com/org/repository/pull/42" aria-label="Pull request URL" /><button className="primaryButton" disabled={submitMutation.isPending}>{submitMutation.isPending ? 'Verifying & signing…' : 'Send for verification'}</button></form>
            {submitErrorMessage && <p className="formError" role="alert">{submitErrorMessage}</p>}
          </div>
        )}

        {isOwner && (bounty.status === 'READY_FOR_REVIEW' || (bounty.status === 'SUBMITTED' && (bounty.reviewPlan === 'NONE' || Boolean(bounty.revisionRequests?.length)))) && (
          <div className="maintainerReview"><h3>Decision</h3><div><button className="decisionButton revisionDecisionButton" onClick={() => setRevisionComposerOpen(true)} disabled={reviewMutation.isPending}>Request revision</button><button className="decisionButton approveDecisionButton" onClick={() => reviewMutation.mutate({ type: 'approve' })} disabled={reviewMutation.isPending}>{reviewMutation.isPending ? 'Processing…' : 'Approve & release'}</button></div></div>
        )}
        {reviewMutation.error && !revisionComposerOpen && <p className="formError" role="alert">{reviewMutation.error.message}</p>}
        {success && <p className="formSuccess" role="status">{success}</p>}

        {(bounty.fundingTxHash || bounty.payoutTxHash) && <div className="detailFooter">{bounty.fundingTxHash && <a href={`${goatTestnet.blockExplorers.default.url}/tx/${bounty.fundingTxHash}`} target="_blank" rel="noreferrer">Funding transaction <ArrowUpRight /></a>}{bounty.payoutTxHash && <a href={`${goatTestnet.blockExplorers.default.url}/tx/${bounty.payoutTxHash}`} target="_blank" rel="noreferrer">Payout transaction <ArrowUpRight /></a>}</div>}
      </section>
      <AnimatePresence>
        {reviewInfo && <ReviewPackageInfoModal key={reviewInfo} plan={reviewInfo} onClose={() => setReviewInfo(null)} />}
        {reportOpen && bounty.decision && <AgentReportModal key="agent-report" bountyId={bounty.id} criteria={bounty.criteria} decision={bounty.decision} submission={bounty.submission} onClose={() => setReportOpen(false)} />}
        {revisionComposerOpen && <RevisionRequestModal key="revision-request" value={revisionMessage} pending={reviewMutation.isPending} error={reviewMutation.error?.message} onChange={setRevisionMessage} onClose={() => setRevisionComposerOpen(false)} onSubmit={() => reviewMutation.mutate({ type: 'revision', message: revisionMessage.trim() })} />}
      </AnimatePresence>
    </div>
  );
}

function RevisionRequestModal({ value, pending, error, onChange, onClose, onSubmit }: { value: string; pending: boolean; error?: string; onChange: (value: string) => void; onClose: () => void; onSubmit: () => void }) {
  const trimmedLength = value.trim().length;
  return (
    <motion.div className="reviewInfoBackdrop revisionRequestBackdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && !pending && onClose()}>
      <motion.form className="reviewInfoModal revisionRequestModal" role="dialog" aria-modal="true" aria-labelledby="revision-request-title" initial={{ opacity: 0, y: 18, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: .98 }} transition={{ type: 'spring', stiffness: 380, damping: 31 }} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <button type="button" className="iconButton revisionRequestClose" aria-label="Close revision request" onClick={onClose} disabled={pending}>×</button>
        <span className="revisionRequestEyebrow">Maintainer decision</span>
        <h2 id="revision-request-title">What needs revision?</h2>
        <p>Give the developer clear, actionable changes to make before submitting the pull request again.</p>
        <label htmlFor="revision-message">Revision notes</label>
        <textarea id="revision-message" autoFocus rows={7} minLength={10} maxLength={2000} required value={value} onChange={(event) => onChange(event.target.value)} placeholder="Example: Add coverage for the error case and update the API response documentation." />
        <div className="revisionRequestMeta"><small>{value.length}/2000 · minimum 10 characters</small></div>
        {error && <p className="formError" role="alert">{error}</p>}
        <div className="revisionRequestActions"><button type="button" className="secondaryButton" onClick={onClose} disabled={pending}>Cancel</button><button type="submit" className="decisionButton revisionDecisionButton" disabled={pending || trimmedLength < 10}>{pending ? 'Sending…' : 'Send revision request'}</button></div>
      </motion.form>
    </motion.div>
  );
}

type AgentDecision = NonNullable<Bounty['decision']>;

function AgentReportCard({ decision, onOpen }: { decision: AgentDecision; onOpen: () => void }) {
  const score = Math.round(decision.confidence * 100);
  const tone = reportScoreTone(score);
  return (
    <article className={`agentReportCard reportTone-${tone}`}>
      <ReportGauge score={score} />
      <div className="agentReportSummary">
        <span>Owl AI report</span>
        <h3>{formatDecision(decision.decision)}</h3>
        <small>{reportScoreLabel(score)}</small>
      </div>
      <button type="button" className="agentReportButton" onClick={onOpen}>View report <ArrowUpRight /></button>
    </article>
  );
}

function ReportGauge({ score }: { score: number }) {
  const needleRotation = (Math.min(100, Math.max(0, score)) - 50) * 1.8;
  return (
    <div className="reportGauge" role="img" aria-label={`Owl AI confidence score ${score} out of 100`}>
      <svg viewBox="0 0 200 145" aria-hidden="true">
        <path className="reportGaugeTrack" d="M16 100 A84 84 0 0 1 184 100" pathLength="100" />
        <path className="reportGaugeSegment gaugeRed" d="M16 100 A84 84 0 0 1 50.63 32.04" />
        <path className="reportGaugeSegment gaugeYellow" d="M50.63 32.04 A84 84 0 0 1 125.96 20.11" />
        <path className="reportGaugeSegment gaugeGreen" d="M125.96 20.11 A84 84 0 0 1 184 100" />
        <g className="reportGaugeNeedle" style={{ transform: `rotate(${needleRotation}deg)`, transformOrigin: '100px 100px' }}>
          <line x1="100" y1="100" x2="100" y2="20" />
          <circle className="reportGaugeTip" cx="100" cy="16" r="6" />
        </g>
        <circle className="reportGaugePivot" cx="100" cy="100" r="8" />
        <text className="reportGaugeValue" x="100" y="138" textAnchor="middle"><tspan>{score}</tspan><tspan> /100</tspan></text>
      </svg>
    </div>
  );
}

function AgentReportModal({ bountyId, criteria, decision, submission, onClose }: { bountyId: string; criteria: Bounty['criteria']; decision: AgentDecision; submission?: Bounty['submission']; onClose: () => void }) {
  const score = Math.round(decision.confidence * 100);
  const resultById = new Map((decision.criterionResults ?? []).map((result) => [result.criterionId, result]));
  const results = [...resultById.values()];
  const passedCount = results.filter((result) => result.status === 'PASSED').length;
  const evidenceCount = new Set(results.flatMap((result) => result.evidence)).size;
  const reportEvidence = useQuery({
    queryKey: ['submission-report-evidence', bountyId, submission?.commitSha],
    queryFn: () => owlpayApi.getSubmissionReportEvidence(bountyId),
    enabled: Boolean(submission),
    retry: false
  });
  const changedFiles = reportEvidence.data?.changedFiles ?? submission?.changedFiles;
  const additions = reportEvidence.data?.additions ?? submission?.additions ?? 0;
  const deletions = reportEvidence.data?.deletions ?? submission?.deletions ?? 0;
  return (
    <motion.div className="agentReportBackdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .18 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <motion.section className="agentReportModal" role="dialog" aria-modal="true" aria-labelledby="agent-report-title" initial={{ opacity: 0, y: 16, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: .98 }} transition={{ type: 'spring', stiffness: 380, damping: 31 }}>
        <button type="button" className="iconButton agentReportClose" aria-label="Close Owl AI report" onClick={onClose}>×</button>
        <header className="agentReportModalHeader"><span>Owl AI Agent</span><h2 id="agent-report-title">Review report</h2></header>
        <div className="agentReportOverview">
          <ReportGauge score={score} />
          <div><span>Recommendation</span><strong>{formatDecision(decision.decision)}</strong><small>{reportScoreLabel(score)}</small></div>
        </div>
        <div className="agentReportStats">
          <div><span>Criteria passed</span><strong>{passedCount}/{criteria.length}</strong></div>
          <div><span>Evidence</span><strong>{evidenceCount}</strong></div>
          <div><span>Blocking issues</span><strong>{decision.blockingIssues.length}</strong></div>
          <div><span>{changedFiles === undefined ? 'Commit' : 'Changes reviewed'}</span><strong>{changedFiles === undefined ? reportEvidence.isLoading ? 'Loading…' : submission?.commitSha.slice(0, 8) ?? '—' : `${changedFiles} files · +${additions} −${deletions}`}</strong></div>
        </div>
        <section className="agentCriteriaReport" aria-labelledby="agent-criteria-title">
          <div className="agentCriteriaHeader"><h3 id="agent-criteria-title">Criteria</h3><span>{criteria.length} checked</span></div>
          <div className="agentCriteriaList">
            {criteria.map((criterion) => {
              const result = resultById.get(criterion.id);
              const status = result?.status ?? 'UNKNOWN';
              return <article className={`agentCriterion criterion-${status.toLowerCase()}`} key={criterion.id}><span className="agentCriterionStatus">{status === 'PASSED' ? <Check /> : status === 'FAILED' ? '!' : '?'}</span><div><strong>{criterion.description}</strong><p>{result?.summary ?? 'No conclusive evidence was returned.'}</p></div><small>{status === 'PASSED' ? 'Passed' : status === 'FAILED' ? 'Failed' : 'Needs review'}</small></article>;
            })}
          </div>
        </section>
        {decision.blockingIssues.length > 0 && <section className="agentBlockingIssues"><h3>Blocking issues</h3>{decision.blockingIssues.map((issue) => <p key={issue}>{issue}</p>)}</section>}
      </motion.section>
    </motion.div>
  );
}

function reportScoreTone(score: number) {
  if (score >= 60) return 'green';
  if (score >= 30) return 'yellow';
  return 'red';
}

function reportScoreLabel(score: number) {
  if (score >= 60) return 'High confidence';
  if (score >= 30) return 'Moderate confidence';
  return 'Low confidence';
}

function formatDecision(decision: AgentDecision['decision']) {
  if (decision === 'APPROVE') return 'Approve';
  if (decision === 'REVISION_REQUIRED') return 'Revision required';
  return 'Human review';
}

function ReviewPackageInfoModal({ plan, onClose }: { plan: 'STANDARD' | 'SECURITY'; onClose: () => void }) {
  const isSecurity = plan === 'SECURITY';
  const checks = isSecurity
    ? ['All Standard checks', 'Deep pull-request diff analysis', 'Security and secret risk signals']
    : ['Acceptance criteria', 'Pull request and commit evidence', 'GitHub CI results'];
  return (
    <motion.div className="reviewInfoBackdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .18 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <motion.section className={`reviewInfoModal ${isSecurity ? 'securityReviewInfoModal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="review-info-title" initial={{ opacity: 0, y: 16, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: .98 }} transition={{ type: 'spring', stiffness: 380, damping: 31 }}>
        <button type="button" className="iconButton reviewInfoClose" aria-label="Close review details" onClick={onClose}>×</button>
        <span className="reviewInfoEyebrow">Owl AI Agent</span>
        <div className="reviewInfoHero">
          <span className="reviewPackageLogo"><ReviewOwlLogo tone={isSecurity ? 'security' : 'standard'} /></span>
          <h3 id="review-info-title">{isSecurity ? 'Security review' : 'Standard review'}</h3>
        </div>
        <div className="reviewInfoChecks">{checks.map((check, index) => <div key={check}><span>{index + 1}</span><strong>{check}</strong></div>)}</div>
      </motion.section>
    </motion.div>
  );
}

function ReviewOwlLogo({ tone }: { tone: 'standard' | 'security' }) {
  const filterId = `review-owl-${tone}`;
  const color = tone === 'security' ? [0.72, 0.46, 0.02] : [0.34, 0.38, 0.44];
  return (
    <svg viewBox="300 140 650 960" aria-hidden="true">
      <defs>
        <filter id={filterId} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={`0 0 0 0 ${color[0]} 0 0 0 0 ${color[1]} 0 0 0 0 ${color[2]} -0.2126 -0.7152 -0.0722 0 1`} />
        </filter>
      </defs>
      <image href="/owlpay-logo.png" width="1254" height="1254" filter={`url(#${filterId})`} />
    </svg>
  );
}

function getRepositoryIdentity(repositoryUrl: string) {
  try {
    const [owner = 'github', repository = 'repository'] = new URL(repositoryUrl).pathname.split('/').filter(Boolean);
    return { fullName: `${owner}/${repository}`, avatarUrl: `https://github.com/${owner}.png?size=96` };
  } catch {
    return { fullName: 'GitHub repository', avatarUrl: 'https://github.com/github.png?size=96' };
  }
}
