import { DomainError } from '../domain/errors.js';

export interface AuthUser {
  id: string;
  githubId: number | null;
  githubLogin: string | null;
  avatarUrl: string | null;
  identityVerified: boolean;
  /**
   * Set only by the demo verifier, which has no real GitHub identity to bind
   * against. Checks that must fail closed for real sessions consult this flag
   * so the local demo stays usable without weakening deployed environments —
   * `NODE_ENV=production` already refuses to boot without Supabase persistence.
   */
  isDemoUser?: boolean;
}

export interface AuthVerifier {
  requireUser(authorization?: string): Promise<AuthUser>;
  optionalUser(authorization?: string): Promise<AuthUser | null>;
}

export class DemoAuthVerifier implements AuthVerifier {
  async requireUser(): Promise<AuthUser> {
    return { id: '00000000-0000-0000-0000-000000000000', githubId: null, githubLogin: 'demo-user', avatarUrl: null, identityVerified: false, isDemoUser: true };
  }

  async optionalUser(): Promise<AuthUser> {
    return this.requireUser();
  }
}

export function readBearerToken(authorization?: string) {
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
  if (!match?.[1]) throw new DomainError('GitHub sign-in is required', 401, 'AUTH_REQUIRED');
  return match[1];
}
