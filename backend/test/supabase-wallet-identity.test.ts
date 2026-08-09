import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { SupabaseWalletIdentity } from '../src/infrastructure/supabase-wallet-identity.js';
import type { AuthUser } from '../src/application/auth.js';
import { createFakeSupabase, type Row } from './helpers/fake-supabase.js';

const account = privateKeyToAccount(`0x${'1'.repeat(64)}`);
const walletAddress = account.address.toLowerCase();
const user: AuthUser = { id: 'user-1', githubId: 42, githubLogin: 'maintainer', avatarUrl: null, identityVerified: true };
const otherUser: AuthUser = { ...user, id: 'user-2', githubLogin: 'someone-else' };

function setup(profile: Row = { id: 'user-1', wallet_address: null, wallet_verified_at: null }) {
  const supabase = createFakeSupabase({ profiles: [profile, { id: 'user-2', wallet_address: null, wallet_verified_at: null }], wallet_challenges: [] });
  return { supabase, identity: new SupabaseWalletIdentity(supabase.client) };
}

async function linkWallet(identity: SupabaseWalletIdentity, actor: AuthUser = user) {
  const challenge = await identity.createChallenge(actor, walletAddress);
  const signature = await account.signMessage({ message: challenge.message });
  return { challenge, signature };
}

describe('supabase wallet identity', () => {
  it('links a wallet when the signature matches the issued challenge', async () => {
    const { identity } = setup();
    const { challenge, signature } = await linkWallet(identity);
    expect(await identity.verify(user, challenge.challengeId, signature)).toEqual({ walletAddress, verified: true });
    expect(await identity.getStatus(user)).toEqual({ walletAddress, verified: true });
  });

  it('binds the challenge to one wallet, one user and one nonce', async () => {
    const { identity, supabase } = setup();
    const { challenge } = await linkWallet(identity);
    const stored = supabase.tables.wallet_challenges![0]!;
    expect(stored.user_id).toBe('user-1');
    expect(stored.wallet_address).toBe(walletAddress);
    expect(challenge.message).toContain(walletAddress);
    expect(challenge.message).toMatch(/Nonce: [0-9a-f]{64}/);
    // A signature must never be reusable as a transaction authorisation.
    expect(challenge.message).toContain('Signing does not authorize a transaction or payment.');
  });

  it('rejects a signature produced by a different wallet', async () => {
    const { identity } = setup();
    const challenge = await identity.createChallenge(user, walletAddress);
    const impostor = privateKeyToAccount(`0x${'2'.repeat(64)}`);
    const signature = await impostor.signMessage({ message: challenge.message });
    await expect(identity.verify(user, challenge.challengeId, signature))
      .rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
  });

  it('refuses to consume another user\'s challenge', async () => {
    const { identity } = setup();
    const { challenge, signature } = await linkWallet(identity);
    await expect(identity.verify(otherUser, challenge.challengeId, signature))
      .rejects.toMatchObject({ code: 'CHALLENGE_NOT_FOUND' });
  });

  it('accepts a challenge only once', async () => {
    const { identity } = setup();
    const { challenge, signature } = await linkWallet(identity);
    await identity.verify(user, challenge.challengeId, signature);
    await expect(identity.verify(user, challenge.challengeId, signature))
      .rejects.toMatchObject({ code: 'CHALLENGE_EXPIRED' });
  });

  it('rejects an expired challenge', async () => {
    const { identity, supabase } = setup();
    const { challenge, signature } = await linkWallet(identity);
    supabase.tables.wallet_challenges![0]!.expires_at = new Date(Date.now() - 1_000).toISOString();
    await expect(identity.verify(user, challenge.challengeId, signature))
      .rejects.toMatchObject({ code: 'CHALLENGE_EXPIRED' });
  });

  it('reports a wallet already linked to another account as a conflict', async () => {
    const { identity, supabase } = setup();
    const { challenge, signature } = await linkWallet(identity);
    supabase.failNext({ code: '23505', message: 'duplicate key value violates unique constraint' }, 'profiles');
    await expect(identity.verify(user, challenge.challengeId, signature))
      .rejects.toMatchObject({ code: 'WALLET_IN_USE', statusCode: 409 });
  });

  it('requires the linked wallet to match the address being used', async () => {
    const { identity } = setup();
    const { challenge, signature } = await linkWallet(identity);
    await identity.verify(user, challenge.challengeId, signature);

    await expect(identity.assertLinked(user, walletAddress)).resolves.toBeUndefined();
    await expect(identity.assertLinked(user, `0x${'9'.repeat(40)}`))
      .rejects.toMatchObject({ code: 'WALLET_NOT_LINKED', statusCode: 403 });
  });

  it('treats an unverified profile as unlinked', async () => {
    // A wallet address written without a verification timestamp must not pass.
    const { identity } = setup({ id: 'user-1', wallet_address: walletAddress, wallet_verified_at: null });
    await expect(identity.assertLinked(user, walletAddress))
      .rejects.toMatchObject({ code: 'WALLET_NOT_LINKED' });
  });
});
