import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyMessage } from 'viem';
import type { AuthUser } from '../application/auth.js';
import type { WalletIdentity, WalletStatus } from '../application/wallet-identity.js';
import { DomainError } from '../domain/errors.js';

interface ChallengeRow {
  id: string;
  user_id: string;
  wallet_address: string;
  message: string;
  expires_at: string;
  consumed_at: string | null;
}

export class SupabaseWalletIdentity implements WalletIdentity {
  constructor(private readonly client: SupabaseClient) {}

  async getStatus(user: AuthUser): Promise<WalletStatus> {
    const { data, error } = await this.client.from('profiles').select('wallet_address,wallet_verified_at').eq('id', user.id).single();
    if (error) throw new Error(`Supabase profile lookup failed: ${error.message}`);
    return { walletAddress: data.wallet_address as string | null, verified: Boolean(data.wallet_verified_at) };
  }

  async createChallenge(user: AuthUser, address: string) {
    const challengeId = randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const nonce = randomBytes(32).toString('hex');
    const normalizedAddress = address.toLowerCase();
    const message = [
      'OwlPay wallet verification',
      `GitHub: ${user.githubLogin ?? user.id}`,
      `Wallet: ${normalizedAddress}`,
      `Nonce: ${nonce}`,
      `Expires: ${expiresAt}`,
      '',
      'Signing does not authorize a transaction or payment.'
    ].join('\n');
    const { error } = await this.client.from('wallet_challenges').insert({
      id: challengeId,
      user_id: user.id,
      wallet_address: normalizedAddress,
      message,
      expires_at: expiresAt
    });
    if (error) throw new Error(`Supabase challenge creation failed: ${error.message}`);
    return { challengeId, message, expiresAt };
  }

  async verify(user: AuthUser, challengeId: string, signature: string): Promise<WalletStatus> {
    const { data, error } = await this.client.from('wallet_challenges').select('*').eq('id', challengeId).eq('user_id', user.id).maybeSingle();
    if (error) throw new Error(`Supabase challenge lookup failed: ${error.message}`);
    if (!data) throw new DomainError('Wallet challenge not found', 404, 'CHALLENGE_NOT_FOUND');
    const challenge = data as ChallengeRow;
    if (challenge.consumed_at || new Date(challenge.expires_at).getTime() <= Date.now()) {
      throw new DomainError('Wallet challenge has expired or was already used', 400, 'CHALLENGE_EXPIRED');
    }
    const valid = await verifyMessage({
      address: challenge.wallet_address as `0x${string}`,
      message: challenge.message,
      signature: signature as `0x${string}`
    });
    if (!valid) throw new DomainError('Wallet signature is invalid', 400, 'INVALID_SIGNATURE');

    const now = new Date().toISOString();
    const { data: consumed, error: consumeError } = await this.client
      .from('wallet_challenges')
      .update({ consumed_at: now })
      .eq('id', challenge.id)
      .is('consumed_at', null)
      .select('id')
      .maybeSingle();
    if (consumeError) throw new Error(`Supabase challenge update failed: ${consumeError.message}`);
    if (!consumed) throw new DomainError('Wallet challenge was already used', 400, 'CHALLENGE_EXPIRED');

    const { error: profileError } = await this.client.from('profiles').update({
      wallet_address: challenge.wallet_address,
      wallet_verified_at: now,
      updated_at: now
    }).eq('id', user.id);
    if (profileError) {
      if (profileError.code === '23505') throw new DomainError('This wallet is already linked to another GitHub account', 409, 'WALLET_IN_USE');
      throw new Error(`Supabase wallet update failed: ${profileError.message}`);
    }
    return { walletAddress: challenge.wallet_address, verified: true };
  }

  async assertLinked(user: AuthUser, address: string) {
    const status = await this.getStatus(user);
    if (!status.verified || status.walletAddress?.toLowerCase() !== address.toLowerCase()) {
      throw new DomainError('Link this wallet to your GitHub account before continuing', 403, 'WALLET_NOT_LINKED');
    }
  }
}
