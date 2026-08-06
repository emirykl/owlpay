'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { encodeFunctionData, formatUnits, keccak256, parseUnits, stringToHex } from 'viem';
import { owlpayApi } from '@/lib/api';
import { useWallet } from './wallet-provider';
import { contractAddress, contractsReady, erc20Abi, owlPayAbi, paymentTokenAddress } from '@/lib/contracts';
import { goatPublicClient } from '@/lib/network';
import { useAuth } from './auth-provider';
import { Check, GitHubMark, LinkMark, MetaMaskMark } from './icons';
import { WalletButton } from './wallet-button';
import { IdentityButton } from './identity-button';

const steps = ['Repository', 'Details', 'Reward & review', 'Review & fund'];

function defaultDeadline() {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export function CreateBounty({ onClose }: { onClose: () => void }) {
  const reduceMotion = useReducedMotion();
  const { address, sendTransaction } = useWallet();
  const { configured: authConfigured, user, githubLogin, signIn } = useAuth();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [criterion, setCriterion] = useState('Existing tests must pass');
  const [rewardAmount, setRewardAmount] = useState('20');
  const [reviewPlan, setReviewPlan] = useState<'STANDARD' | 'SECURITY'>('STANDARD');
  const [minimumDeadline] = useState(() => new Date(Date.now() + 3_600_000).toISOString().slice(0, 16));
  const [formError, setFormError] = useState<string | null>(null);

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
  const identityLinked = Boolean(address)
    && identity.data?.wallet.verified
    && identity.data.wallet.walletAddress?.toLowerCase() === address?.toLowerCase();
  const tokenBalance = useQuery({
    queryKey: ['payment-token-balance', address],
    queryFn: async () => goatPublicClient.readContract({
      address: paymentTokenAddress!, abi: erc20Abi, functionName: 'balanceOf', args: [address!]
    }),
    enabled: Boolean(address && paymentTokenAddress && contractsReady),
    retry: false
  });
  const claimMutation = useMutation({
    mutationFn: async () => {
      if (!paymentTokenAddress) throw new Error('Test token is not configured.');
      const hash = await sendTransaction({
        to: paymentTokenAddress,
        data: encodeFunctionData({ abi: erc20Abi, functionName: 'claim' })
      });
      await goatPublicClient.waitForTransactionReceipt({ hash });
    },
    onSuccess: () => tokenBalance.refetch()
  });

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
        criteria: [{ id: crypto.randomUUID(), description: criterion, mandatory: true, method: 'ci' as const }]
      };
      const draft = await owlpayApi.createBounty(input);
      if (!contractsReady || !contractAddress || !paymentTokenAddress) return draft;
      const bountyContract = contractAddress;
      const paymentToken = paymentTokenAddress;
      const reward = parseUnits(input.rewardAmount, 6);
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
      return owlpayApi.markFunded(draft.id, BigInt(bountyLog.topics[1]).toString(), fundingTxHash);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['bounties'] });
      onClose();
    }
  });

  const titleValid = title.trim().length >= 5;
  const descriptionValid = description.trim().length >= 10;
  const deadlineValid = Boolean(deadline) && new Date(deadline).getTime() >= new Date(minimumDeadline).getTime();
  const canContinue = step === 0
    ? repositoryUrl.length > 0
    : step === 1
      ? titleValid && descriptionValid && deadlineValid
      : criterion.trim().length >= 3 && Number(rewardAmount) > 0;

  const platformFeeRate = (network.data?.platformFeeBps ?? 300) / 10_000;
  const platformFee = Number(rewardAmount || 0) * platformFeeRate;
  const developerPayout = Math.max(0, Number(rewardAmount || 0) - platformFee);
  const reviewPrice = Number(reviewPlan === 'SECURITY' ? network.data?.reviewPrices.security ?? 5 : network.data?.reviewPrices.standard ?? 2);
  const rewardUnits = /^\d+(\.\d{0,6})?$/.test(rewardAmount) ? parseUnits(rewardAmount || '0', 6) : BigInt(0);
  const hasEnoughReward = !contractsReady || tokenBalance.data === undefined || tokenBalance.data >= rewardUnits;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (step < 3) {
      if (canContinue) setStep((current) => current + 1);
      return;
    }
    if (new Date(deadline).getTime() < Date.now() + 3_600_000) {
      setFormError('The deadline is too close or has passed. Go back to Details and choose a time at least 1 hour from now.');
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
                  <div className="stepCopy"><h3>Which repository needs work?</h3><p>We only show public repositories where your GitHub account has push, maintain, or admin access.</p></div>
                  {authConfigured && !user ? (
                    <div className="connectionGate providerGate"><span className="connectionProviderIcon githubConnectionIcon"><GitHubMark /></span><div><strong>Connect GitHub</strong><p>OwlPay needs your GitHub identity to verify repository ownership.</p></div><button type="button" className="secondaryButton providerAction" onClick={signIn}><GitHubMark />Connect GitHub</button></div>
                  ) : authConfigured && repositories.isLoading ? (
                    <div className="connectionGate"><div><strong>Loading repositories…</strong><p>Checking access for @{githubLogin}.</p></div></div>
                  ) : authConfigured && repositories.isError ? (
                    <div className="connectionGate errorGate providerGate"><span className="connectionProviderIcon githubConnectionIcon"><GitHubMark /></span><div><strong>Reconnect GitHub</strong><p>{repositories.error.message}</p></div><button type="button" className="secondaryButton providerAction" onClick={signIn}><GitHubMark />Authorize access</button></div>
                  ) : authConfigured && repositories.data?.items.length === 0 ? (
                    <div className="connectionGate"><div><strong>No manageable public repository</strong><p>You need push, maintain, or admin access for the MVP.</p></div></div>
                  ) : (
                    <label className="wizardField"><span>GitHub repository</span>{authConfigured ? (
                      <select value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)} required>
                        <option value="" disabled>Select a repository</option>
                        {repositories.data?.items.map((repository) => <option value={repository.url} key={repository.id}>{repository.fullName} · {repository.permission}</option>)}
                      </select>
                    ) : <input value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)} type="url" required placeholder="https://github.com/org/repository" />}</label>
                  )}
                </>
              )}

              {step === 1 && (
                <>
                  <div className="stepCopy"><h3>Describe the outcome.</h3><p>Write what should exist when the work is complete. Keep implementation details in the repository.</p></div>
                  <div className="wizardFieldGrid">
                    <label className="wizardField full"><span>Title</span><input value={title} onChange={(event) => setTitle(event.target.value)} required minLength={5} maxLength={120} placeholder="Add a health endpoint" autoFocus />{!titleValid && <small className="fieldValidation">Use at least 5 characters · {title.trim().length}/5</small>}</label>
                    <label className="wizardField full"><span>Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} required minLength={10} rows={4} placeholder="Describe the expected outcome and constraints." />{!descriptionValid && <small className="fieldValidation">Use at least 10 characters · {description.trim().length}/10</small>}</label>
                    <label className="wizardField full"><span>Deadline</span><input value={deadline} onChange={(event) => setDeadline(event.target.value)} type="datetime-local" required min={minimumDeadline} />{!deadlineValid && <small className="fieldValidation">Choose a deadline at least 1 hour from now.</small>}</label>
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <div className="stepCopy"><h3>Set the reward and review.</h3><p>The developer receives 97% after approval. The one-time Owl Agent review is paid separately by you.</p></div>
                  <div className="wizardFieldGrid">
                    <label className="wizardField full"><span>Mandatory acceptance criterion</span><input value={criterion} onChange={(event) => setCriterion(event.target.value)} required minLength={3} autoFocus /></label>
                    <label className="wizardField"><span>Reward · USDC</span><input value={rewardAmount} onChange={(event) => setRewardAmount(event.target.value)} inputMode="decimal" pattern="\d+(\.\d{1,6})?" required /></label>
                    <label className="wizardField"><span>Owl Agent review</span><select value={reviewPlan} onChange={(event) => setReviewPlan(event.target.value as 'STANDARD' | 'SECURITY')}><option value="STANDARD">Standard · {network.data?.reviewPrices.standard ?? '2'} USDC</option><option value="SECURITY">Security · {network.data?.reviewPrices.security ?? '5'} USDC</option></select></label>
                  </div>
                  <p className="fieldHint">Payout: {developerPayout.toFixed(2)} USDC to developer · {platformFee.toFixed(2)} USDC OwlPay fee ({(platformFeeRate * 100).toFixed(0)}%). Review is purchased once before analysis.</p>
                </>
              )}

              {step === 3 && (
                <>
                  <div className="stepCopy"><h3>Review before funding.</h3><p>Confirm the repository, evidence requirement, reward, and deadline. Nothing is sent until you approve the wallet action.</p></div>
                  <div className="reviewCard">
                    <div className="reviewMain"><span>{repositoryUrl.replace('https://github.com/', '')}</span><h3>{title}</h3><p>{description}</p></div>
                    <div className="reviewGrid"><div><span>Escrow reward</span><strong>{rewardAmount} USDC</strong></div><div><span>Developer receives</span><strong>{developerPayout.toFixed(2)} USDC</strong></div><div><span>Platform fee</span><strong>{platformFee.toFixed(2)} USDC · {(platformFeeRate * 100).toFixed(0)}%</strong></div><div><span>Review package</span><strong>{reviewPrice.toFixed(2)} USDC · owner pays</strong></div><div><span>Deadline</span><strong>{new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(deadline))}</strong></div></div>
                    <div className="reviewCriterion"><span><Check /></span><p><strong>Mandatory evidence</strong><small>{criterion}</small></p></div>
                  </div>
                  {!address && <div className="connectionGate walletGate providerGate"><span className="connectionProviderIcon metamaskConnectionIcon"><MetaMaskMark /></span><div><strong>Connect MetaMask to fund</strong><p>Your connected address becomes the bounty owner on GOAT Testnet3.</p></div><WalletButton /></div>}
                  {address && authConfigured && !identityLinked && <div className="connectionGate walletGate providerGate"><span className="connectionProviderIcon linkConnectionIcon"><LinkMark /></span><div><strong>Link GitHub and wallet</strong><p>Sign one verification message so OwlPay can bind this bounty to your identity.</p></div><IdentityButton /></div>}
                  {address && (!authConfigured || identityLinked) && <div className="readyNotice"><span className="statusDot" /><p><strong>Identity ready</strong><small>@{githubLogin} · {address.slice(0, 8)}…{address.slice(-6)}</small></p></div>}
                  {address && contractsReady && <div className="connectionGate"><div><strong>Test token balance</strong><p>{tokenBalance.data === undefined ? 'Loading…' : `${formatUnits(tokenBalance.data, 6)} otUSDC`} · reward escrow needs {rewardAmount || '0'}.</p></div>{!hasEnoughReward && <button type="button" className="secondaryButton" onClick={() => claimMutation.mutate()} disabled={claimMutation.isPending}>{claimMutation.isPending ? 'Claiming…' : 'Claim 1,000 otUSDC'}</button>}</div>}
                  {claimMutation.error && <p className="formError" role="alert">{claimMutation.error.message}</p>}
                </>
              )}
            </motion.div>
          </AnimatePresence>

          {(formError || mutation.error) && <p className="formError" role="alert">{formError ?? mutation.error?.message}</p>}
          <div className="wizardActions">
            <button type="button" className="secondaryButton" onClick={() => step === 0 ? onClose() : setStep((current) => current - 1)}>{step === 0 ? 'Cancel' : 'Back'}</button>
            <button className="primaryButton" disabled={mutation.isPending || (step < 3 ? !canContinue : !address || !hasEnoughReward || (authConfigured && !identityLinked))}>{mutation.isPending ? 'Creating…' : step < 3 ? 'Continue' : contractsReady ? 'Fund on testnet' : 'Create draft'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
