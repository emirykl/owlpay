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
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!reviewInfo) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && setReviewInfo(null);
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [reviewInfo]);

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
      setSuccess(bounty.reviewPlan === 'NONE'
        ? `Commit ${result.evidence.headSha.slice(0, 8)} submitted. It is ready for the maintainer's manual review.`
        : bounty.reviewPaymentStatus === 'PAID'
        ? `Commit ${result.evidence.headSha.slice(0, 8)} submitted. Owl Agent review started automatically.`
        : `Commit ${result.evidence.headSha.slice(0, 8)} submitted. The maintainer must purchase the review package.`);
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

        {bounty.assignedDeveloperGithubLogin && <div className="assignedNotice"><span className="statusDot" /><p><strong>Assigned to @{bounty.assignedDeveloperGithubLogin}</strong><small>{isAssignedDeveloper ? `Estimated payout: ${estimatedPayout.toFixed(2)} otUSDC after the ${(platformFeeRate * 100).toFixed(0)}% OwlPay fee.` : 'Only the selected developer can submit work.'}</small></p></div>}

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

        {bounty.decision && <div className={`decisionCard decision-${bounty.decision.decision.toLowerCase()}`}><span>Owl Agent report · {Math.round(bounty.decision.confidence * 100)}%</span><h3>{bounty.decision.decision.replaceAll('_', ' ')}</h3><p>{bounty.decision.summary}</p>{bounty.decision.blockingIssues.map((issue) => <small key={issue}>{issue}</small>)}</div>}

        {isAssignedDeveloper && ['ASSIGNED', 'REVISION_REQUIRED'].includes(bounty.status) && (
          <div className="detailSection submissionSection">
            <div className="detailSectionTitle"><h3>{bounty.status === 'REVISION_REQUIRED' ? 'Submit revision' : 'Submit your work'}</h3><span>Signed in as @{githubLogin}</span></div>
            <form className="submissionForm" onSubmit={submitWork}><input name="pullRequestUrl" type="url" required placeholder="https://github.com/org/repository/pull/42" aria-label="Pull request URL" /><button className="primaryButton" disabled={submitMutation.isPending}>{submitMutation.isPending ? 'Verifying & signing…' : 'Send for verification'}</button></form>
            {submitErrorMessage && <p className="formError" role="alert">{submitErrorMessage}</p>}
          </div>
        )}

        {isOwner && (bounty.status === 'READY_FOR_REVIEW' || (bounty.reviewPlan === 'NONE' && bounty.status === 'SUBMITTED')) && (
          <div className="maintainerReview"><div><strong>{bounty.reviewPlan === 'NONE' ? 'Manual review' : 'Maintainer decision'}</strong><p>{bounty.reviewPlan === 'NONE' ? 'Inspect the pull request yourself, then approve payment or request a revision.' : 'Review the Owl Agent report and the pull request before approving payment.'}</p></div><div><button className="secondaryButton" onClick={() => reviewMutation.mutate('revision')} disabled={reviewMutation.isPending}>Request revision</button><button className="primaryButton" onClick={() => reviewMutation.mutate('approve')} disabled={reviewMutation.isPending}>{reviewMutation.isPending ? 'Processing…' : 'Approve & release'}</button></div></div>
        )}
        {reviewMutation.error && <p className="formError" role="alert">{reviewMutation.error.message}</p>}
        {success && <p className="formSuccess" role="status">{success}</p>}

        {(bounty.fundingTxHash || bounty.payoutTxHash) && <div className="detailFooter">{bounty.fundingTxHash && <a href={`${goatTestnet.blockExplorers.default.url}/tx/${bounty.fundingTxHash}`} target="_blank" rel="noreferrer">Funding transaction <ArrowUpRight /></a>}{bounty.payoutTxHash && <a href={`${goatTestnet.blockExplorers.default.url}/tx/${bounty.payoutTxHash}`} target="_blank" rel="noreferrer">Payout transaction <ArrowUpRight /></a>}</div>}
      </section>
      <AnimatePresence>
        {reviewInfo && <ReviewPackageInfoModal key={reviewInfo} plan={reviewInfo} onClose={() => setReviewInfo(null)} />}
      </AnimatePresence>
    </div>
  );
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
