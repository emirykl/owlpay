import type { AuthUser } from './auth.js';

export interface WalletStatus {
  walletAddress: string | null;
  verified: boolean;
}

export interface WalletIdentity {
  getStatus(user: AuthUser): Promise<WalletStatus>;
  createChallenge(user: AuthUser, address: string): Promise<{ challengeId: string; message: string; expiresAt: string }>;
  verify(user: AuthUser, challengeId: string, signature: string): Promise<WalletStatus>;
  assertLinked(user: AuthUser, address: string): Promise<void>;
}

