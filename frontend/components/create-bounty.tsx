'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { encodeFunctionData, keccak256, parseUnits, stringToHex } from 'viem';
import { owlpayApi } from '@/lib/api';
import { useWallet } from './wallet-provider';
import { contractAddress, contractsReady, erc20Abi, owlPayAbi, paymentTokenAddress } from '@/lib/contracts';
import { goatPublicClient } from '@/lib/network';
import { useAuth } from './auth-provider';

export function CreateBounty({ onClose }: { onClose: () => void }) {
  const { address, sendTransaction } = useWallet();
  const { configured: authConfigured, user, signIn } = useAuth();
  const queryClient = useQueryClient();
  const [criterion, setCriterion] = useState('Existing tests must pass');
  const [minimumDeadline] = useState(() => new Date(Date.now() + 3_600_000).toISOString().slice(0, 16));
  const mutation = useMutation({
    mutationFn: async (input: Parameters<typeof owlpayApi.createBounty>[0]) => {
      const draft = await owlpayApi.createBounty(input);
      if (!contractsReady || !contractAddress || !paymentTokenAddress) return draft;
      const bountyContract = contractAddress;
      const paymentToken = paymentTokenAddress;

      const reward = parseUnits(input.rewardAmount, 6);
      const budget = parseUnits(input.verificationBudget, 6);
      const taskHash = keccak256(stringToHex(JSON.stringify({
        title: input.title,
        description: input.description,
        repositoryUrl: input.repositoryUrl,
        criteria: input.criteria
      })));
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
          args: [paymentToken, reward, budget, BigInt(Math.floor(new Date(input.deadline).getTime() / 1000)), taskHash]
        })
      });
      const receipt = await goatPublicClient.waitForTransactionReceipt({ hash: fundingTxHash });
      const bountyLog = receipt.logs.find((log) => log.address.toLowerCase() === bountyContract.toLowerCase() && log.topics.length > 1);
      if (!bountyLog?.topics[1]) throw new Error('BountyCreated event was not found in the transaction receipt.');
      const onchainId = BigInt(bountyLog.topics[1]).toString();
      return owlpayApi.markFunded(draft.id, onchainId, fundingTxHash);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['bounties'] });
      onClose();
    }
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!address) return;
    const data = new FormData(event.currentTarget);
    mutation.mutate({
      title: String(data.get('title')),
      description: String(data.get('description')),
      repositoryUrl: String(data.get('repositoryUrl')),
      ownerAddress: address,
      rewardAmount: String(data.get('rewardAmount')),
      verificationBudget: String(data.get('verificationBudget')),
      deadline: new Date(String(data.get('deadline'))).toISOString(),
      criteria: [{ id: crypto.randomUUID(), description: criterion, mandatory: true, method: 'ci' }]
    });
  }

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
        <div className="modalHeader">
          <div><span className="eyebrow">New bounty</span><h2 id="create-title">Define measurable work.</h2></div>
          <button className="iconButton" onClick={onClose} aria-label="Close">×</button>
        </div>
        {authConfigured && !user ? (
          <div className="emptyState compact"><h3>Connect GitHub first</h3><p>Your GitHub identity will be bound to the bounty owner.</p><button className="secondaryButton" onClick={signIn}>Connect GitHub</button></div>
        ) : !address ? (
          <div className="emptyState compact"><h3>Connect your wallet first</h3><p>The connected address becomes the bounty owner.</p></div>
        ) : (
          <form className="bountyForm" onSubmit={submit}>
            <label><span>Title</span><input name="title" required minLength={5} maxLength={120} placeholder="Add a health endpoint" /></label>
            <label><span>GitHub repository</span><input name="repositoryUrl" type="url" required placeholder="https://github.com/org/repository" /></label>
            <label className="full"><span>Description</span><textarea name="description" required minLength={10} rows={3} placeholder="Describe the expected outcome and constraints." /></label>
            <label className="full"><span>Mandatory criterion</span><input value={criterion} onChange={(event) => setCriterion(event.target.value)} required minLength={3} /></label>
            <label><span>Reward · USDC</span><input name="rewardAmount" inputMode="decimal" pattern="\d+(\.\d{1,6})?" defaultValue="20" required /></label>
            <label><span>Verification cap · USDC</span><input name="verificationBudget" inputMode="decimal" pattern="\d+(\.\d{1,6})?" defaultValue="0.50" required /></label>
            <label className="full"><span>Deadline</span><input name="deadline" type="datetime-local" required min={minimumDeadline} /></label>
            {mutation.error && <p className="formError" role="alert">{mutation.error.message}</p>}
            <div className="formActions"><button type="button" className="secondaryButton" onClick={onClose}>Cancel</button><button className="primaryButton" disabled={mutation.isPending}>{mutation.isPending ? 'Creating…' : contractsReady ? 'Fund on testnet' : 'Create draft'}</button></div>
          </form>
        )}
      </section>
    </div>
  );
}
