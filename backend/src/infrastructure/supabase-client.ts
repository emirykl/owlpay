import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AuthUser, AuthVerifier } from '../application/auth.js';
import { readBearerToken } from '../application/auth.js';
import { DomainError } from '../domain/errors.js';

export function createSupabaseAdminClient(url: string, secretKey: string) {
  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });
}

export class SupabaseAuthVerifier implements AuthVerifier {
  constructor(private readonly client: SupabaseClient) {}

  async requireUser(authorization?: string): Promise<AuthUser> {
    const token = readBearerToken(authorization);
    const { data, error } = await this.client.auth.getUser(token);
    if (error || !data.user) throw new DomainError('Invalid or expired session', 401, 'INVALID_SESSION');
    const metadata = data.user.user_metadata as Record<string, unknown>;
    return {
      id: data.user.id,
      githubLogin: typeof metadata.user_name === 'string'
        ? metadata.user_name
        : typeof metadata.preferred_username === 'string' ? metadata.preferred_username : null,
      avatarUrl: typeof metadata.avatar_url === 'string' ? metadata.avatar_url : null,
      identityVerified: true
    };
  }

  async optionalUser(authorization?: string): Promise<AuthUser | null> {
    if (!authorization) return null;
    return this.requireUser(authorization);
  }
}
