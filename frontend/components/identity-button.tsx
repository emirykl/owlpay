'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { owlpayApi } from '@/lib/api';
import { useAuth } from './auth-provider';
import { useWallet } from './wallet-provider';
import { LinkMark } from './icons';

export function IdentityButton() {
  const queryClient = useQueryClient();
  const { configured, user } = useAuth();
  const { address, signMessage } = useWallet();
  const identity = useQuery({
    queryKey: ['identity'],
    queryFn: owlpayApi.me,
    enabled: configured && Boolean(user),
    retry: false
  });
  const mutation = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error('Connect your wallet first.');
      const challenge = await owlpayApi.createWalletChallenge(address);
      const signature = await signMessage(challenge.message);
      return owlpayApi.verifyWallet(challenge.challengeId, signature);
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['identity'] })
  });

  if (!configured || !user || !address) return null;
  const linked = identity.data?.wallet.verified
    && identity.data.wallet.walletAddress?.toLowerCase() === address.toLowerCase();
  if (linked) return null;
  return (
    <button className="identityButton" onClick={() => mutation.mutate()} disabled={mutation.isPending} title={mutation.error?.message}>
      <LinkMark />
      {mutation.isPending ? 'Signing…' : mutation.isError ? 'Try link again' : 'Link accounts'}
    </button>
  );
}
