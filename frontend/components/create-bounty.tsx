'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { encodeFunctionData, formatUnits, keccak256, parseUnits, stringToHex } from 'viem';
import { owlpayApi } from '@/lib/api';
import { useWallet } from './wallet-provider';
import { contractAddress, erc20Abi, owlPayAbi, paymentTokenAddress } from '@/lib/contracts';
import { goatPublicClient } from '@/lib/network';
import { useAuth } from './auth-provider';
import { Check, GitHubMark, LinkMark, MetaMaskMark } from './icons';
import { WalletButton } from './wallet-button';
import { IdentityButton } from './identity-button';
import { getTransactionErrorMessage } from '@/lib/transaction-error';

const steps = ['Repository', 'Details', 'Reward & review', 'Review & fund'];
const HOUR = 3_600_000;
const WEEK = 7 * 24 * HOUR;

function toLocalDateTimeInput(timestamp: number) {
  const date = new Date(timestamp);
  return new Date(timestamp - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function defaultDeadline() {
  return toLocalDateTimeInput(Date.now() + 3 * 24 * HOUR);
}

export function CreateBounty({ onClose }: { onClose: () => void }) {
  const reduceMotion = useReducedMotion();
  const { address, sendTransaction, payGoatFlowOrder } = useWallet();
  const { configured: authConfigured, user, githubLogin, signIn } = useAuth();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [criterion, setCriterion] = useState('The pull request fulfills the requested bounty changes');
  const [requireCi, setRequireCi] = useState(false);
  const [rewardAmount, setRewardAmount] = useState('20');
  const [reviewPlan, setReviewPlan] = useState<'NONE' | 'STANDARD' | 'SECURITY'>('STANDARD');
  const [deadlineBounds] = useState(() => ({
    minimum: toLocalDateTimeInput(Date.now() + HOUR + 60_000),
    maximum: toLocalDateTimeInput(Date.now() + WEEK - 60_000)
  }));
  const [formError, setFormError] = useState<string | null>(null);
  const [repositoryPickerOpen, setRepositoryPickerOpen] = useState(false);
  const [repositorySearch, setRepositorySearch] = useState('');
  const creationProgress = useRef<{
    draft?: Awaited<ReturnType<typeof owlpayApi.createBounty>>;
    funded?: Awaited<ReturnType<typeof owlpayApi.markFunded>>;
  }>({});

  const repositories = useQuery({
    queryKey: ['github-repositories', user?.id],
    queryFn: owlpayApi.listManageableRepositories,
    enabled: authConfigured && Boolean(user),
    retry: false
  });
  const identity = useQuery({
    queryKey: ['identity'],
    queryFn: owlpayApi.me,
    enabled: authConfigured && Boolean(user),
    retry: false
  });
  const network = useQuery({ queryKey: ['network'], queryFn: owlpayApi.network, retry: false });
  const reviewToken = network.data?.reviewPaymentToken;
  const reviewTokenAddress = reviewToken?.address;
  const rewardToken = network.data?.paymentToken;
  const rewardTokenAddress = rewardToken?.address ?? paymentTokenAddress;
  const rewardTokenSymbol = rewardToken?.symbol ?? 'USDC';
  const rewardTokenDecimals = rewardToken?.decimals ?? 6;
  const activeContractAddress = network.data?.contractAddress ?? contractAddress;
  const contractsReady = Boolean(
    activeContractAddress && /^0x[a-fA-F0-9]{40}$/.test(activeContractAddress)
    && rewardTokenAddress && /^0x[a-fA-F0-9]{40}$/.test(rewardTokenAddress)
  );
  const identityLinked = Boolean(address)
    && identity.data?.wallet.verified
    && identity.data.wallet.walletAddress?.toLowerCase() === address?.toLowerCase();
  const tokenBalance = useQuery({
    queryKey: ['payment-token-balance', rewardTokenAddress, address],
    queryFn: async () => goatPublicClient.readContract({
      address: rewardTokenAddress as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [address!]
    }),
    enabled: Boolean(address && rewardTokenAddress && contractsReady),
    retry: false
  });
  const reviewTokenBalance = useQuery({
    queryKey: ['review-token-balance', reviewTokenAddress, address],
    queryFn: async () => goatPublicClient.readContract({
      address: reviewTokenAddress as `0x${string}`,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address!]
    }),
    enabled: Boolean(address && reviewTokenAddress && reviewPlan !== 'NONE'),
    retry: false
  });
  const selectedRepository = repositories.data?.items.find((repository) => repository.url === repositoryUrl);
  const repositoryFullName = selectedRepository?.fullName ?? repositoryUrl.replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '');
  const repositoryOwner = selectedRepository?.ownerLogin ?? repositoryFullName.split('/')[0] ?? 'GitHub';
  const repositoryAvatarUrl = selectedRepository?.ownerAvatarUrl ?? (repositoryOwner ? `https://github.com/${encodeURIComponent(repositoryOwner)}.png?size=128` : undefined);
  const filteredRepositories = useMemo(() => {
    const query = repositorySearch.trim().toLowerCase();
    return (repositories.data?.items ?? []).filter((repository) => !query || repository.fullName.toLowerCase().includes(query));
  }, [repositories.data?.items, repositorySearch]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error('Connect your wallet before funding the bounty.');
      const input = {
        title,
        description,
        repositoryUrl,
        ownerAddress: address,
        rewardAmount,
        reviewPlan,
        deadline: new Date(deadline).toISOString(),
        criteria: [
          { id: crypto.randomUUID(), description: criterion, mandatory: true, method: 'github' as const },
          ...(requireCi ? [{ id: crypto.randomUUID(), description: 'Configured GitHub checks must pass', mandatory: true, method: 'ci' as const }] : [])
        ]
      };
      const draft = creationProgress.current.draft ?? await owlpayApi.createBounty(input);
      creationProgress.current.draft = draft;
      if (!contractsReady || !activeContractAddress || !rewardTokenAddress) return draft;
      if (creationProgress.current.funded?.reviewPaymentStatus === 'PAID' || reviewPlan === 'NONE') {
        if (creationProgress.current.funded) return creationProgress.current.funded;
      }
      const bountyContract = (draft.escrowContractAddress ?? activeContractAddress) as `0x${string}`;
      const paymentToken = rewardTokenAddress as `0x${string}`;
      const reward = parseUnits(input.rewardAmount, rewardTokenDecimals);
      let funded = creationProgress.current.funded;
      if (!funded) {
        const taskHash = keccak256(stringToHex(JSON.stringify({ title, description, repositoryUrl, criteria: input.criteria })));
        const approvalHash = await sendTransaction({
          to: paymentToken,
          data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [bountyContract, reward] })
        });
        await goatPublicClient.waitForTransactionReceipt({ hash: approvalHash });
        const fundingTxHash = await sendTransaction({
          to: bountyContract,
          data: encodeFunctionData({
            abi: owlPayAbi,
            functionName: 'createBounty',
            args: [reward, BigInt(Math.floor(new Date(input.deadline).getTime() / 1000)), taskHash]
          })
        });
        const receipt = await goatPublicClient.waitForTransactionReceipt({ hash: fundingTxHash });
        const bountyLog = receipt.logs.find((log) => log.address.toLowerCase() === bountyContract.toLowerCase() && log.topics.length > 1);
        if (!bountyLog?.topics[1]) throw new Error('BountyCreated event was not found in the transaction receipt.');
        funded = await owlpayApi.markFunded(draft.id, BigInt(bountyLog.topics[1]).toString(), fundingTxHash);
        creationProgress.current.funded = funded;
      }
      if (reviewPlan === 'NONE' || funded.reviewPaymentStatus === 'PAID') return funded;
      const paidReviewPlan = reviewPlan === 'SECURITY' ? 'SECURITY' : 'STANDARD';
      const order = await owlpayApi.requestReviewPayment(draft.id, paidReviewPlan);
      const reviewPaymentHash = order.clientTxHash as `0x${string}` | undefined ?? await payGoatFlowOrder(order);
      const paid = await owlpayApi.confirmReviewPayment(draft.id, order.orderId, reviewPaymentHash);
      creationProgress.current.funded = paid;
      return paid;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['bounties'] });
      onClose();
    }
  });

  const titleValid = title.trim().length >= 5;
  const descriptionValid = description.trim().length >= 10;
  const deadlineTimestamp = new Date(deadline).getTime();
  const deadlineTooSoon = !deadline || deadlineTimestamp < new Date(deadlineBounds.minimum).getTime();
  const deadlineTooLate = Boolean(deadline) && deadlineTimestamp > new Date(deadlineBounds.maximum).getTime();
  const deadlineValid = !deadlineTooSoon && !deadlineTooLate;
  const canContinue = step === 0
    ? repositoryUrl.length > 0
    : step === 1
      ? titleValid && descriptionValid && deadlineValid
      : criterion.trim().length >= 3 && Number(rewardAmount) > 0;

  const reviewPrice = Number(reviewPlan === 'NONE'
    ? 0
    : reviewPlan === 'SECURITY'
      ? network.data?.reviewPrices.security ?? 2
      : network.data?.reviewPrices.standard ?? 1);
  const reviewTokenSymbol = reviewToken?.symbol ?? 'USDC';
  const reviewTokenDecimals = reviewToken?.decimals ?? 6;
  const rewardUnits = /^\d+(\.\d{0,6})?$/.test(rewardAmount) ? parseUnits(rewardAmount || '0', rewardTokenDecimals) : BigInt(0);
  const reviewUnits = parseUnits(String(reviewPrice), reviewTokenDecimals);
  const samePaymentToken = Boolean(reviewTokenAddress && rewardTokenAddress && reviewTokenAddress.toLowerCase() === rewardTokenAddress.toLowerCase() && reviewTokenDecimals === rewardTokenDecimals);
  const rewardUnitsNeeded = samePaymentToken ? rewardUnits + reviewUnits : rewardUnits;
  const hasEnoughRewardBalance = !contractsReady || tokenBalance.data === undefined || tokenBalance.data >= rewardUnitsNeeded;
  const hasEnoughReviewBalance = reviewPlan === 'NONE'
    || Boolean(reviewTokenAddress && (
      samePaymentToken
      || reviewTokenBalance.data === undefined
      || reviewTokenBalance.data >= reviewUnits
    ));
  const hasEnoughBalance = hasEnoughRewardBalance && hasEnoughReviewBalance;
  const rewardBalanceCovered = tokenBalance.data !== undefined && tokenBalance.data >= rewardUnitsNeeded;
  const showSeparateReviewBalance = reviewPlan !== 'NONE' && !samePaymentToken;
  const reviewBalanceCovered = Boolean(
    reviewTokenAddress
    && reviewTokenBalance.data !== undefined
    && reviewTokenBalance.data >= reviewUnits
  );
  const visibleBalancesCovered = rewardBalanceCovered && (!showSeparateReviewBalance || reviewBalanceCovered);
  const visibleBalancesChecking = tokenBalance.data === undefined
    || Boolean(showSeparateReviewBalance && reviewTokenAddress && reviewTokenBalance.data === undefined);
  const balanceSummaryState = visibleBalancesChecking ? 'checking' : visibleBalancesCovered ? 'covered' : 'attention';
  const creationErrorMessage = getTransactionErrorMessage(mutation.error, 'The funding transaction could not be completed. Please try again.');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (step < 3) {
      if (canContinue) setStep((current) => current + 1);
      return;
    }
    if (new Date(deadline).getTime() < Date.now() + HOUR) {
      setFormError('The deadline is too close or has passed. Go back to Details and choose a time at least 1 hour from now.');
      return;
    }
    if (new Date(deadline).getTime() > Date.now() + WEEK) {
      setFormError('The deadline is too far away. Go back to Details and choose a time within the next 7 days.');
      return;
    }
    mutation.mutate();
  }

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal bountyWizard" role="dialog" aria-modal="true" aria-labelledby="create-title">
        <div className="modalHeader wizardHeader">
          <div><span className="eyebrow">New bounty · Step {step + 1} of 4</span><h2 id="create-title">{steps[step]}</h2></div>
          <button className="iconButton" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="wizardProgress" aria-label="Bounty creation progress">
          {steps.map((label, index) => <div className={index < step ? 'complete' : index === step ? 'active' : ''} key={label}><span>{index < step ? <Check /> : index + 1}</span><small>{label}</small></div>)}
        </div>

        <form className="wizardForm" onSubmit={submit}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              className="wizardStep"
              key={step}
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0, x: 18 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -18 }}
              transition={{ duration: 0.24 }}
            >
              {step === 0 && (
                <>
                  <div className="stepCopy"><h3>Choose a repository</h3></div>
                  {authConfigured && !user ? (
                    <div className="connectionGate providerGate"><span className="connectionProviderIcon githubConnectionIcon"><GitHubMark /></span><div><strong>Connect GitHub</strong><p>OwlPay needs your GitHub identity to verify repository ownership.</p></div><button type="button" className="secondaryButton providerAction" onClick={signIn}><GitHubMark />Connect GitHub</button></div>
                  ) : authConfigured && repositories.isLoading ? (
                    <div className="connectionGate"><div><strong>Loading repositories…</strong><p>Checking access for @{githubLogin}.</p></div></div>
                  ) : authConfigured && repositories.isError ? (
                    <div className="connectionGate errorGate providerGate"><span className="connectionProviderIcon githubConnectionIcon"><GitHubMark /></span><div><strong>Reconnect GitHub</strong><p>{repositories.error.message}</p></div><button type="button" className="secondaryButton providerAction" onClick={signIn}><GitHubMark />Authorize access</button></div>
                  ) : authConfigured && repositories.data?.items.length === 0 ? (
                    <div className="connectionGate"><div><strong>No manageable public repository</strong><p>You need push, maintain, or admin access for the MVP.</p></div></div>
                  ) : (
                    <div className="wizardField"><span>GitHub repository</span>{authConfigured ? (
                      <div className={`repositoryPicker ${repositoryPickerOpen ? 'open' : ''}`}>
                        <button type="button" className="repositoryPickerTrigger" onClick={() => setRepositoryPickerOpen((open) => !open)} aria-expanded={repositoryPickerOpen}>
                          {selectedRepository ? <><span className="repositoryPickerAvatar" style={selectedRepository.ownerAvatarUrl ? { backgroundImage: `url(${selectedRepository.ownerAvatarUrl})` } : undefined}>{selectedRepository.ownerAvatarUrl ? '' : selectedRepository.ownerLogin.slice(0, 1).toUpperCase()}</span><strong>{selectedRepository.fullName}</strong><small>{selectedRepository.permission}</small></> : <strong>Select a repository</strong>}
                          <span className="repositoryPickerChevron">⌄</span>
                        </button>
                        {repositoryPickerOpen && <div className="repositoryPickerMenu">
                          <label className="repositoryPickerSearch"><span>⌕</span><input value={repositorySearch} onChange={(event) => setRepositorySearch(event.target.value)} onKeyDown={(event) => event.key === 'Escape' && setRepositoryPickerOpen(false)} placeholder="Search repositories" autoFocus /></label>
                          <div className="repositoryPickerList">{filteredRepositories.length ? filteredRepositories.map((repository) => <button type="button" className={repository.url === repositoryUrl ? 'selected' : ''} key={repository.id} onClick={() => { setRepositoryUrl(repository.url); setRepositoryPickerOpen(false); setRepositorySearch(''); }}><span className="repositoryPickerAvatar" style={repository.ownerAvatarUrl ? { backgroundImage: `url(${repository.ownerAvatarUrl})` } : undefined}>{repository.ownerAvatarUrl ? '' : repository.ownerLogin.slice(0, 1).toUpperCase()}</span><strong>{repository.fullName}</strong><small>{repository.permission}</small></button>) : <p>No repositories found.</p>}</div>
                        </div>}
                      </div>
                    ) : <input value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)} type="url" required placeholder="https://github.com/org/repository" />}</div>
                  )}
                </>
              )}

              {step === 1 && (
                <>
                  <div className="stepCopy"><h3>Describe the outcome</h3></div>
                  <div className="wizardFieldGrid">
                    <label className="wizardField full"><span>Title</span><input value={title} onChange={(event) => setTitle(event.target.value)} required minLength={5} maxLength={120} placeholder="Add a health endpoint" autoFocus />{!titleValid && <small className="fieldValidation">Use at least 5 characters · {title.trim().length}/5</small>}</label>
                    <label className="wizardField full"><span>Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} required minLength={10} rows={4} placeholder="Describe the expected outcome and constraints." />{!descriptionValid && <small className="fieldValidation">Use at least 10 characters · {description.trim().length}/10</small>}</label>
                    <label className="wizardField full"><span>Deadline</span><input value={deadline} onChange={(event) => setDeadline(event.target.value)} type="datetime-local" required min={deadlineBounds.minimum} max={deadlineBounds.maximum} />{deadlineTooSoon && <small className="fieldValidation">Choose a time at least 1 hour from now.</small>}{deadlineTooLate && <small className="fieldValidation">Choose a time within the next 7 days.</small>}</label>
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <div className="stepCopy"><h3>Reward & review</h3></div>
                  <div className="wizardFieldGrid">
                    <label className="wizardField full"><span>Mandatory acceptance criterion</span><input value={criterion} onChange={(event) => setCriterion(event.target.value)} required minLength={3} autoFocus /></label>
                    <label className={`ciRequirementToggle full ${requireCi ? 'enabled' : ''}`}>
                      <input type="checkbox" checked={requireCi} onChange={(event) => setRequireCi(event.target.checked)} />
                      <span><strong>Require GitHub CI checks</strong><small>Enable only when this repository has GitHub Actions or another configured check suite that must pass.</small></span>
                    </label>
                    <label className="wizardField full"><span>Reward · {rewardTokenSymbol}</span><input value={rewardAmount} onChange={(event) => setRewardAmount(event.target.value)} inputMode="decimal" pattern="\d+(\.\d{1,6})?" required /></label>
                    <div className="wizardField full">
                      <span>Review method</span>
                      <div className="reviewPlanChoices" role="radiogroup" aria-label="Review method">
                        <ReviewPlanChoice
                          checked={reviewPlan === 'NONE'}
                          description="You inspect the pull request and decide whether to release payment. No agent report or review fee."
                          label="Manual"
                          price="Free"
                          value="NONE"
                          onChange={setReviewPlan}
                        />
                        <ReviewPlanChoice
                          checked={reviewPlan === 'STANDARD'}
                          description="Checks the bounty requirements and pull-request evidence, plus CI only when you require it. Paid once while funding the bounty."
                          label="Standard"
                          price={`${network.data?.reviewPrices.standard ?? '1'} ${reviewTokenSymbol}`}
                          value="STANDARD"
                          onChange={setReviewPlan}
                        />
                        <ReviewPlanChoice
                          checked={reviewPlan === 'SECURITY'}
                          description="Includes the standard checks plus a deeper diff scan for secrets, risky execution, and security signals."
                          label="Security"
                          price={`${network.data?.reviewPrices.security ?? '2'} ${reviewTokenSymbol}`}
                          value="SECURITY"
                          onChange={setReviewPlan}
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}

              {step === 3 && (
                <>
                  <div className="stepCopy"><h3>Review & fund</h3></div>
                  <div className="reviewCard">
                    <div className="reviewMain">
                      <span className="reviewRepositoryAvatar" style={repositoryAvatarUrl ? { backgroundImage: `url(${repositoryAvatarUrl})` } : undefined}>{repositoryAvatarUrl ? '' : repositoryOwner.slice(0, 1).toUpperCase()}</span>
                      <div className="reviewMainCopy"><span>{repositoryFullName}</span><h3>{title}</h3><p>{description}</p></div>
                    </div>
                    <div className="reviewGrid"><div><span>Escrow reward</span><strong>{rewardAmount} {rewardTokenSymbol}</strong></div><div><span>Review method</span><strong>{reviewPlan === 'NONE' ? 'Manual · Free' : `${reviewPlan === 'SECURITY' ? 'Security' : 'Standard'} · ${reviewPrice.toFixed(2)} ${reviewTokenSymbol} paid now`}</strong></div><div><span>Deadline</span><strong>{new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(deadline))}</strong></div></div>
                    <div className="reviewCriterion"><span><Check /></span><p><strong>Mandatory evidence</strong><small>{criterion}</small></p></div>
                    {requireCi && <div className="reviewCriterion ciReviewCriterion"><span><Check /></span><p><strong>CI required</strong><small>Configured GitHub checks must pass.</small></p></div>}
                  </div>
                  {!address && <div className="connectionGate walletGate providerGate"><span className="connectionProviderIcon metamaskConnectionIcon"><MetaMaskMark /></span><div><strong>Connect MetaMask to fund</strong><p>Your connected address becomes the bounty owner on GOAT Testnet3.</p></div><WalletButton /></div>}
                  {address && authConfigured && !identityLinked && <div className="connectionGate walletGate providerGate"><span className="connectionProviderIcon linkConnectionIcon"><LinkMark /></span><div><strong>Link GitHub and wallet</strong><p>Sign one verification message so OwlPay can bind this bounty to your identity.</p></div><IdentityButton /></div>}
                  {address && (!authConfigured || identityLinked) && <div className="readyNotice"><span className="statusDot" /><p><strong>Identity ready</strong><small>@{githubLogin} · {address.slice(0, 8)}…{address.slice(-6)}</small></p></div>}
                  {address && contractsReady && (
                    <section className={`balanceSummary ${balanceSummaryState}`} aria-labelledby="balance-summary-title">
                      <header className="balanceSummaryHeader">
                        <div><span>Cost breakdown</span><h4 id="balance-summary-title">Total</h4></div>
                        <span className={`balanceSummaryStatus ${balanceSummaryState}`}>
                          {visibleBalancesChecking ? 'Checking balance' : visibleBalancesCovered ? 'Balance sufficient' : 'Insufficient balance'}
                        </span>
                      </header>
                      <div className="balanceSummaryRows">
                        <div className="balanceSummaryRow">
                          <span className={`balanceCheckBadge covered`} role="img" aria-label="Escrow cost"><Check /></span>
                          <div className="balanceSummaryCopy">
                            <span>Escrow reward</span>
                            <strong>{rewardAmount} {rewardTokenSymbol}</strong>
                          </div>
                        </div>
                        {reviewPlan !== 'NONE' && (
                          <div className="balanceSummaryRow">
                            <span className={`balanceCheckBadge covered`} role="img" aria-label="Owl AI review cost"><Check /></span>
                            <div className="balanceSummaryCopy">
                              <span>Owl AI · {reviewPlan === 'SECURITY' ? 'Security' : 'Standard'}</span>
                              <strong>{reviewPrice} {reviewTokenSymbol}</strong>
                            </div>
                          </div>
                        )}
                        <div className="balanceSummaryRow balanceSummaryTotal">
                          <span className={`balanceCheckBadge ${visibleBalancesChecking ? 'checking' : visibleBalancesCovered ? 'covered' : 'insufficient'}`} role="img" aria-label={visibleBalancesChecking ? 'Checking wallet balance' : visibleBalancesCovered ? 'Wallet balance is sufficient' : 'Wallet balance is insufficient'}>
                            {visibleBalancesChecking ? '…' : visibleBalancesCovered ? <Check /> : '!'}
                          </span>
                          <div className="balanceSummaryCopy">
                            <span>Total cost</span>
                            <strong>{formatUnits(rewardUnits + reviewUnits, rewardTokenDecimals)} {rewardTokenSymbol}</strong>
                            {!hasEnoughBalance && <small>Insufficient balance. Add GOAT Testnet3 USDC to your wallet.</small>}
                          </div>
                        </div>
                      </div>
                    </section>
                  )}
                </>
              )}
            </motion.div>
          </AnimatePresence>

          {(formError || creationErrorMessage) && <p className="formError" role="alert">{formError ?? creationErrorMessage}</p>}
          <div className="wizardActions">
            <button type="button" className="secondaryButton" onClick={() => step === 0 ? onClose() : setStep((current) => current - 1)}>{step === 0 ? 'Cancel' : 'Back'}</button>
            <button className="primaryButton" disabled={mutation.isPending || (step < 3 ? !canContinue : !address || !hasEnoughBalance || (authConfigured && !identityLinked))}>{mutation.isPending ? 'Creating…' : step < 3 ? 'Continue' : contractsReady ? reviewPlan === 'NONE' ? 'Fund on testnet' : 'Fund & pay review' : 'Create draft'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

type ReviewPlan = 'NONE' | 'STANDARD' | 'SECURITY';

function ReviewPlanChoice({ checked, description, label, price, value, onChange }: {
  checked: boolean;
  description: string;
  label: string;
  price: string;
  value: ReviewPlan;
  onChange: (value: ReviewPlan) => void;
}) {
  const reduceMotion = useReducedMotion();
  const [showInfo, setShowInfo] = useState(false);
  return (
    <motion.label
      className={`reviewPlanChoice plan-${value.toLowerCase()} ${checked ? 'selected' : ''}`}
      whileHover={reduceMotion ? undefined : { y: -3, scale: 1.01 }}
      transition={{ type: 'spring', stiffness: 360, damping: 25 }}
    >
      <input type="radio" name="reviewPlan" value={value} checked={checked} onChange={() => onChange(value)} />
      <span><strong>{label}</strong><small>{price}</small></span>
      <span
        className={`reviewHelp ${showInfo ? 'open' : ''}`}
        role="button"
        tabIndex={0}
        aria-label={`${label} review information`}
        aria-expanded={showInfo}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); setShowInfo((open) => !open); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            setShowInfo((open) => !open);
          }
        }}
      >?
        <span role="tooltip">{description}</span>
      </span>
    </motion.label>
  );
}
