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
import { AgentReportCard, AgentReportModal, ReviewOwlLogo, ReviewPackageInfoModal } from './bounty-review-panels';
import { getBountyDeadlineState } from '@/lib/bounty-deadline';
import { getTransactionErrorMessage } from '@/lib/transaction-error';
import { bountyTokenSymbol } from '@/lib/bounty-token';

const LIVE_SYNC_INTERVAL = 4_000;
const CONFETTI_COLORS = ['#2f9e67', '#f4c928', '#ef5a4f', '#f19a26', '#4f7bd9'];
const CONFETTI_PIECES = Array.from({ length: 30 }, (_, index) => ({
  id: index,
  color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
  x: ((index * 83) % 980) - 490,
  lift: 100 + ((index * 37) % 190),
  fall: 360 + ((index * 61) % 330),
  rotation: 420 + ((index * 97) % 620),
  delay: (index % 8) * 0.035,
  duration: 1.8 + ((index * 19) % 70) / 100
}));

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
  const [appealMessage, setAppealMessage] = useState('');
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
  const applicationSlots = useQuery({ queryKey: ['application-slots', user?.id], queryFn: owlpayApi.getApplicationSlots, enabled: Boolean(user) && !isOwner, retry: false });
  const slotsRemaining = applicationSlots.data?.remaining ?? null;
  const slotsFull = slotsRemaining !== null && slotsRemaining <= 0;
  const network = useQuery({ queryKey: ['network'], queryFn: owlpayApi.network, retry: false });
  const bountyContractAddress = (bounty.escrowContractAddress ?? contractAddress) as `0x${string}` | undefined;
  const bountyContractReady = Boolean(bountyContractAddress && /^0x[a-fA-F0-9]{40}$/.test(bountyContractAddress));
  const deadline = getBountyDeadlineState(bounty.deadline, now);
  const contributorDeadline = getBountyDeadlineState(bounty.contributorDeadline ?? bounty.deadline, now);
  const maintainerDeadline = getBountyDeadlineState(bounty.maintainerReviewDeadline ?? bounty.deadline, now);
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
  const rewardTokenSymbol = bountyTokenSymbol(bounty, network.data?.paymentToken.symbol ?? 'USDC');
  const paidReviewAmount = Number(bounty.reviewPaidAmount ?? (bounty.reviewPaymentStatus === 'PAID' ? bounty.reviewPrice : 0));
  const securityActive = bounty.reviewPlan === 'SECURITY' && paidReviewAmount >= securityPrice && ['PAID', 'CONSUMED'].includes(bounty.reviewPaymentStatus);
  const standardActive = !securityActive && bounty.reviewPlan === 'STANDARD' && paidReviewAmount >= standardPrice && ['PAID', 'CONSUMED'].includes(bounty.reviewPaymentStatus);
  const canUpgradeReview = isOwner && bounty.reviewPaymentStatus !== 'CONSUMED' && !['PAID', 'REFUNDED', 'CANCELLED'].includes(bounty.status);
  const latestRevisionRequest = bounty.revisionRequests?.at(-1);
  const revisionCount = bounty.revisionRequests?.length ?? 0;
  const reviewWindowClosed = maintainerDeadline.closed;
  const revisionWindowClosed = reviewWindowClosed || new Date(bounty.maintainerReviewDeadline).getTime() - now < 2 * 24 * 60 * 60 * 1_000;
  const canRequestRevision = revisionCount < 2 && !revisionWindowClosed;
  const deliveryExpired = contributorDeadline.closed && ['OPEN', 'ASSIGNED', 'REVISION_REQUIRED', 'EXPIRED'].includes(bounty.status);
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
        queryClient.invalidateQueries({ queryKey: ['my-applications', user?.id] }),
        queryClient.invalidateQueries({ queryKey: ['application-slots'] })
      ]);
    }
  });
  const assignMutation = useMutation({
    mutationFn: async (application: BountyApplication) => {
      let assignmentTxHash: string | undefined;
      if (contractsReady && bountyContractReady && bountyContractAddress && bounty.onchainId && /^\d+$/.test(bounty.onchainId)) {
        if (!address || address.toLowerCase() !== bounty.ownerAddress.toLowerCase()) {
          throw new Error('Connect the wallet that funded this bounty before assigning a developer.');
        }
        assignmentTxHash = await sendTransaction({
          to: bountyContractAddress,
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
      if (contractsReady && bountyContractReady && bountyContractAddress && bounty.onchainId && /^\d+$/.test(bounty.onchainId)) {
        submissionTxHash = await sendTransaction({
          to: bountyContractAddress,
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
  const appealMutation = useMutation({
    mutationFn: () => owlpayApi.appealResolution(bounty.id, appealMessage.trim()),
    onSuccess: async (updated) => {
      setAppealMessage('');
      setSuccess('Appeal submitted. The escrow is paused for manual dispute review.');
      queryClient.setQueryData(['bounty', bounty.id], updated);
      await queryClient.invalidateQueries({ queryKey: ['bounties'] });
    }
  });
  const refundMutation = useMutation({
    mutationFn: async () => {
      if (!address || address.toLowerCase() !== bounty.ownerAddress.toLowerCase()) throw new Error('Connect the wallet that funded this bounty.');
      if (!contractsReady || !bountyContractReady || !bountyContractAddress || !bounty.onchainId || !/^\d+$/.test(bounty.onchainId)) throw new Error('The escrow contract is not configured for this bounty.');
      const refundTxHash = await sendTransaction({
        to: bountyContractAddress,
        data: encodeFunctionData({ abi: owlPayAbi, functionName: 'refundExpiredBounty', args: [BigInt(bounty.onchainId)] })
      });
      await goatPublicClient.waitForTransactionReceipt({ hash: refundTxHash });
      return owlpayApi.markRefunded(bounty.id, refundTxHash);
    },
    onSuccess: async (updated) => {
      setSuccess('The missed-delivery bounty was refunded to the maintainer wallet.');
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
            <div><dt>Reward</dt><dd>{bounty.rewardAmount} {rewardTokenSymbol}</dd></div>
            {!isClosed && <div><dt>Applications</dt><dd>{bounty.applicantCount}</dd></div>}
            <div><dt>Deadline</dt><dd>{deadlineLabel}</dd></div>
          </dl>
        </div>

        {bounty.status !== 'OPEN' && bounty.status !== 'DRAFT' && (
          <div className="resolutionTimeline" aria-label="Bounty resolution timeline">
            <div><span>Contributor deadline</span><strong>{formatWorkflowDeadline(bounty.contributorDeadline, contributorDeadline.label, contributorDeadline.closed)}</strong></div>
            <div><span>Maintainer decision by</span><strong>{formatWorkflowDeadline(bounty.maintainerReviewDeadline, maintainerDeadline.label, maintainerDeadline.closed)}</strong></div>
            <div><span>Revisions</span><strong>{revisionCount}/2 used{bounty.revisionExtensionUsed ? ' · extension used' : ''}</strong></div>
          </div>
        )}

        <div className="detailSection detailCardSection criteriaSection">
          <div className="detailSectionTitle"><h3>Acceptance criteria</h3></div>
          <div className="criteriaList">{bounty.criteria.map((criterion) => <div key={criterion.id}><span className="criteriaIcon"><Check /></span><p><strong>{criterion.description}</strong></p></div>)}</div>
        </div>

        {isOwner && !isClosed && ['OPEN', 'ASSIGNED'].includes(bounty.status) && (
          <div className="detailSection detailCardSection applicationsSection">
            <div className="detailSectionTitle"><h3>Applications</h3><span className="sectionCount">{applications.data?.items.length ?? 0}</span></div>
            {applications.isLoading ? <div className="loadingRows"><i /><i /></div> : applications.data?.items.length === 0 ? <p className="inlineNotice applicationEmpty">No applications yet.</p> : (
              <div className="candidateList">{applications.data?.items.map((application) => <article className="candidateCard" key={application.id}>
                <span className="candidateAvatar" style={application.developerGithubAvatarUrl ? { backgroundImage: `url(${application.developerGithubAvatarUrl})` } : undefined}>{application.developerGithubAvatarUrl ? '' : application.developerGithubLogin.slice(0, 1).toUpperCase()}</span>
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
            ) : slotsFull ? (
              <div className="applicationSlotsFull"><strong>All pending application slots are in use</strong><p>You have {applicationSlots.data?.maxPending ?? 5} pending applications. Withdraw one to free a slot.</p></div>
            ) : (
              <div className="applicationForm">{applicationSlots.data && <div className="applicationSlotHint">{applicationSlots.data.pending}/{applicationSlots.data.maxPending} pending slots used · {applicationSlots.data.remaining} remaining</div>}<textarea value={applicationMessage} onChange={(event) => setApplicationMessage(event.target.value)} minLength={20} maxLength={600} rows={4} placeholder="Briefly explain your experience and how you would approach this bounty." /><div><small>{applicationMessage.length}/600 · minimum 20 characters</small><button className="primaryButton" onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending || applicationMessage.trim().length < 20}>{applyMutation.isPending ? 'Sending…' : 'Send application'}</button></div></div>
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
              ? `Estimated payout ${estimatedPayout.toFixed(2)} ${rewardTokenSymbol} · ${(platformFeeRate * 100).toFixed(0)}% fee`
              : bounty.assignedDeveloperAddress ? `${bounty.assignedDeveloperAddress.slice(0, 8)}…${bounty.assignedDeveloperAddress.slice(-6)}` : 'Verified GitHub developer'}</span>
          </div>
        )}

        {isAssignedDeveloper && bounty.status === 'PAID' && (
          <ContributorPayoutCelebration bountyId={bounty.id} payoutTxHash={bounty.payoutTxHash} amount={estimatedPayout.toFixed(2)} tokenSymbol={rewardTokenSymbol} />
        )}

        {bounty.submission && <div className="submissionCard"><span>Submitted commit</span><strong>{bounty.submission.commitSha.slice(0, 10)}</strong><a href={bounty.submission.pullRequestUrl} target="_blank" rel="noreferrer">Open pull request <ArrowUpRight /></a></div>}

        {bounty.timeoutResolution !== 'NONE' && (
          <TimeoutResolutionCard bounty={bounty} now={now} isAssignedDeveloper={isAssignedDeveloper} appealMessage={appealMessage} onAppealMessage={setAppealMessage} onAppeal={() => appealMutation.mutate()} appealPending={appealMutation.isPending} appealError={appealMutation.error?.message} />
        )}

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

        {isOwner && bounty.decision && <AgentReportCard decision={bounty.decision} onOpen={() => setReportOpen(true)} />}

        {bounty.status === 'REVISION_REQUIRED' && latestRevisionRequest && (isAssignedDeveloper || isOwner) && (
          <article className="revisionFeedbackCard">
            <div className="revisionFeedbackHeader">
              <span>Revision requested</span>
              <time dateTime={latestRevisionRequest.requestedAt}>{new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(latestRevisionRequest.requestedAt))}</time>
            </div>
            <p>{latestRevisionRequest.message}</p>
            <small>Requested for commit {latestRevisionRequest.commitSha.slice(0, 8)}{latestRevisionRequest.extensionGranted ? ` · one-time extension granted until ${formatDateTime(latestRevisionRequest.contributorDeadline ?? bounty.contributorDeadline)}` : ''}</small>
          </article>
        )}

        {isAssignedDeveloper && ['ASSIGNED', 'REVISION_REQUIRED'].includes(bounty.status) && (
          <div className="detailSection submissionSection">
            <div className="detailSectionTitle"><h3>{bounty.status === 'REVISION_REQUIRED' ? 'Submit revision' : 'Submit your work'}</h3><span>Signed in as @{githubLogin}</span></div>
            <form className="submissionForm" onSubmit={submitWork}><input name="pullRequestUrl" type="url" required placeholder="https://github.com/org/repository/pull/42" aria-label="Pull request URL" /><button className="primaryButton" disabled={submitMutation.isPending}>{submitMutation.isPending ? 'Verifying & signing…' : 'Send for verification'}</button></form>
            {submitErrorMessage && <p className="formError" role="alert">{submitErrorMessage}</p>}
          </div>
        )}

        {isOwner && !reviewWindowClosed && (bounty.status === 'READY_FOR_REVIEW' || (bounty.status === 'SUBMITTED' && (bounty.reviewPlan === 'NONE' || Boolean(bounty.revisionRequests?.length)))) && (
          <div className="maintainerReview"><h3>Decision</h3><div><button className="decisionButton revisionDecisionButton" onClick={() => setRevisionComposerOpen(true)} disabled={reviewMutation.isPending || !canRequestRevision} title={!canRequestRevision ? revisionCount >= 2 ? 'The two-revision limit has been reached.' : 'Revisions close during the final 48 hours.' : undefined}>Request revision{revisionCount > 0 ? ` (${revisionCount}/2)` : ''}</button><button className="decisionButton approveDecisionButton" onClick={() => reviewMutation.mutate({ type: 'approve' })} disabled={reviewMutation.isPending}>{reviewMutation.isPending ? 'Processing…' : 'Approve & release'}</button></div></div>
        )}
        {isOwner && deliveryExpired && bounty.status !== 'REFUNDED' && (
          <div className="expiredRefundCard"><div><strong>Contributor delivery window ended</strong><p>No eligible submission was received before the deadline. The escrow can be returned to your wallet.</p></div><button className="decisionButton rejectDecisionButton" onClick={() => refundMutation.mutate()} disabled={refundMutation.isPending}>{refundMutation.isPending ? 'Refunding…' : 'Refund escrow'}</button></div>
        )}
        {reviewMutation.error && !revisionComposerOpen && <p className="formError" role="alert">{reviewMutation.error.message}</p>}
        {refundMutation.error && <p className="formError" role="alert">{getTransactionErrorMessage(refundMutation.error, 'The refund transaction could not be completed. Please try again.')}</p>}
        {success && <p className="formSuccess" role="status">{success}</p>}

        {(bounty.fundingTxHash || bounty.payoutTxHash || bounty.refundTxHash) && <div className="detailFooter">{bounty.fundingTxHash && <a href={`${goatTestnet.blockExplorers.default.url}/tx/${bounty.fundingTxHash}`} target="_blank" rel="noreferrer">Funding transaction <ArrowUpRight /></a>}{bounty.payoutTxHash && <a href={`${goatTestnet.blockExplorers.default.url}/tx/${bounty.payoutTxHash}`} target="_blank" rel="noreferrer">Payout transaction <ArrowUpRight /></a>}{bounty.refundTxHash && <a href={`${goatTestnet.blockExplorers.default.url}/tx/${bounty.refundTxHash}`} target="_blank" rel="noreferrer">Refund transaction <ArrowUpRight /></a>}</div>}
      </section>
      <AnimatePresence>
        {reviewInfo && <ReviewPackageInfoModal key={reviewInfo} plan={reviewInfo} onClose={() => setReviewInfo(null)} />}
        {isOwner && reportOpen && bounty.decision && <AgentReportModal key="agent-report" bountyId={bounty.id} criteria={bounty.criteria} decision={bounty.decision} submission={bounty.submission} onClose={() => setReportOpen(false)} />}
        {revisionComposerOpen && <RevisionRequestModal key="revision-request" value={revisionMessage} pending={reviewMutation.isPending} error={reviewMutation.error?.message} onChange={setRevisionMessage} onClose={() => setRevisionComposerOpen(false)} onSubmit={() => reviewMutation.mutate({ type: 'revision', message: revisionMessage.trim() })} />}
      </AnimatePresence>
    </div>
  );
}

function ContributorPayoutCelebration({ bountyId, payoutTxHash, amount, tokenSymbol }: { bountyId: string; payoutTxHash?: string; amount: string; tokenSymbol: string }) {
  const reduceMotion = useReducedMotion();
  const [burst, setBurst] = useState(false);

  useEffect(() => {
    if (reduceMotion) return;
    const celebrationKey = `owlpay-payout-celebrated:${bountyId}:${payoutTxHash ?? 'paid'}`;
    if (window.sessionStorage.getItem(celebrationKey)) return;
    window.sessionStorage.setItem(celebrationKey, 'true');
    const startTimer = window.setTimeout(() => setBurst(true), 0);
    const stopTimer = window.setTimeout(() => setBurst(false), 3_000);
    return () => {
      window.clearTimeout(startTimer);
      window.clearTimeout(stopTimer);
    };
  }, [bountyId, payoutTxHash, reduceMotion]);

  return (
    <>
      {burst && <div className="payoutConfetti" aria-hidden="true">
        {CONFETTI_PIECES.map((piece) => (
          <motion.i
            key={piece.id}
            style={{ backgroundColor: piece.color }}
            initial={{ x: 0, y: 0, rotate: 0, scale: 0, opacity: 0 }}
            animate={{
              x: [0, piece.x * .45, piece.x],
              y: [0, -piece.lift, piece.fall],
              rotate: [0, piece.rotation * .35, piece.rotation],
              scale: [0, 1, 1, .7],
              opacity: [0, 1, 1, 0]
            }}
            transition={{ duration: piece.duration, delay: piece.delay, ease: [0.2, 0.7, 0.2, 1], times: [0, .22, .78, 1] }}
          />
        ))}
      </div>}
      <motion.article className="contributorWinCard" role="status" initial={reduceMotion ? false : { opacity: 0, y: 10, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 330, damping: 28 }}>
        <span className="contributorWinIcon"><Check /></span>
        <div><small>Bounty successfully completed</small><h3>You earned {amount} {tokenSymbol}</h3><p>The maintainer approved your work and the escrow payment was released to your payout wallet.</p></div>
        {payoutTxHash && <a href={`${goatTestnet.blockExplorers.default.url}/tx/${payoutTxHash}`} target="_blank" rel="noreferrer">View payout <ArrowUpRight /></a>}
      </motion.article>
    </>
  );
}

function TimeoutResolutionCard({ bounty, now, isAssignedDeveloper, appealMessage, onAppealMessage, onAppeal, appealPending, appealError }: {
  bounty: Bounty;
  now: number;
  isAssignedDeveloper: boolean;
  appealMessage: string;
  onAppealMessage: (value: string) => void;
  onAppeal: () => void;
  appealPending: boolean;
  appealError?: string;
}) {
  if (bounty.timeoutResolution === 'NONE') return null;
  const content = {
    AUTO_APPROVED: ['Owl AI timeout decision', 'Approved automatically', 'The maintainer window ended without a decision. The submission met the 60/100 threshold and mandatory safeguards.'],
    AUTO_FAILED_PENDING: ['Owl AI timeout decision', 'Refund pending', 'The score or mandatory evidence did not meet the automatic payout rules. The contributor may appeal before the refund is finalized.'],
    INCONCLUSIVE: ['Owl AI timeout decision', 'Manual dispute review required', 'The evidence was not strong enough for either automatic payout or automatic refund. Escrow remains locked.'],
    DISPUTED: ['Resolution appeal', 'Escrow paused for review', 'The contributor appealed the Owl AI timeout decision. Funds remain locked until the dispute is resolved.'],
    AUTO_REFUNDED: ['Owl AI timeout decision', 'Escrow refunded', 'The appeal window ended and the bounty escrow was returned to the maintainer.']
  }[bounty.timeoutResolution];
  const tone = bounty.timeoutResolution === 'AUTO_APPROVED' ? 'success' : bounty.timeoutResolution === 'AUTO_FAILED_PENDING' ? 'warning' : bounty.timeoutResolution === 'AUTO_REFUNDED' ? 'danger' : 'neutral';
  const canAppeal = bounty.timeoutResolution === 'AUTO_FAILED_PENDING' && isAssignedDeveloper && Boolean(bounty.appealDeadline) && now < new Date(bounty.appealDeadline!).getTime();
  return (
    <article className={`timeoutResolutionCard timeout-${tone}`}>
      <div className="timeoutResolutionCopy"><span>{content[0]}</span><strong>{content[1]}</strong><p>{content[2]}</p>{bounty.appealDeadline && bounty.timeoutResolution === 'AUTO_FAILED_PENDING' && <small>Appeal deadline: {formatDateTime(bounty.appealDeadline)}</small>}</div>
      {canAppeal && <div className="timeoutAppeal"><textarea rows={3} minLength={20} maxLength={2000} value={appealMessage} onChange={(event) => onAppealMessage(event.target.value)} placeholder="Explain why the evidence or score should be reviewed…" /><div><small>{appealMessage.length}/2000 · minimum 20</small><button className="secondaryButton" disabled={appealPending || appealMessage.trim().length < 20} onClick={onAppeal}>{appealPending ? 'Submitting…' : 'Appeal decision'}</button></div>{appealError && <p className="formError" role="alert">{appealError}</p>}</div>}
    </article>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatWorkflowDeadline(value: string, relative: string, closed: boolean) {
  return closed ? `Ended · ${formatDateTime(value)}` : `${relative} · ${formatDateTime(value)}`;
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

function getRepositoryIdentity(repositoryUrl: string) {
  try {
    const [owner = 'github', repository = 'repository'] = new URL(repositoryUrl).pathname.split('/').filter(Boolean);
    // Encoded because the result is interpolated into a CSS url(), where a stray
    // quote or paren would break out of the declaration.
    return { fullName: `${owner}/${repository}`, avatarUrl: `https://github.com/${encodeURIComponent(owner)}.png?size=96` };
  } catch {
    return { fullName: 'GitHub repository', avatarUrl: 'https://github.com/github.png?size=96' };
  }
}
