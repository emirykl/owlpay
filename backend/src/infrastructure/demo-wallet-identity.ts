import type { AuthUser } from '../application/auth.js';
import type { WalletIdentity } from '../application/wallet-identity.js';

export class DemoWalletIdentity implements WalletIdentity {
  async getStatus() { return { walletAddress: null, verified: true }; }
  async createChallenge(_user: AuthUser, address: string) {
    return { challengeId: 'demo', message: `Demo wallet link: ${address}`, expiresAt: new Date(Date.now() + 300_000).toISOString() };
  }
  async verify() { return { walletAddress: null, verified: true }; }
  async assertLinked() {}
}

