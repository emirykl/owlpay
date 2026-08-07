'use client';

import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { owlpayApi } from '@/lib/api';
import { useAuth } from './auth-provider';
import { useWallet } from './wallet-provider';
import { LinkMark } from './icons';

export function IdentityButton() {
  const queryClient = useQueryClient();
  const { configured, user } = useAuth();
  const { address, signMessage } = useWallet();
  const autoLinkAttempted = useRef<string | null>(null);
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

  const linked = configured && user && address
    && identity.data?.wallet.verified
    && identity.data.wallet.walletAddress?.toLowerCase() === address.toLowerCase();

  // Auto-trigger linking when wallet is connected but not yet linked
  useEffect(() => {
    if (!configured || !user || !address || linked) return;
    if (identity.isLoading || !identity.data) return;
    if (mutation.isPending) return;
    // Only auto-attempt once per address to avoid repeated MetaMask popups on rejection
    if (autoLinkAttempted.current === address) return;
    autoLinkAttempted.current = address;
    mutation.mutate();
  }, [configured, user, address, linked, identity.isLoading, identity.data, mutation]);

  if (!configured || !user || !address) return null;
  if (linked) return null;
  return (
    <button className="identityButton" onClick={() => mutation.mutate()} disabled={mutation.isPending} title={mutation.error?.message}>
      <LinkMark />
      {mutation.isPending ? 'Signing…' : mutation.isError ? 'Try link again' : 'Link accounts'}
    </button>
  );
}
