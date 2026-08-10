import type { SupabaseClient } from '@supabase/supabase-js';
import type { ResolutionFailureLog } from '../application/ports.js';

/**
 * Writes unsettled bounties to `resolution_failures` so they outlive the host's
 * log retention.
 *
 * Never throws. The caller is a settlement run that has already committed real
 * work, and losing this record is a smaller loss than losing that report.
 */
export class SupabaseResolutionFailureLog implements ResolutionFailureLog {
  constructor(private readonly client: SupabaseClient) {}

  async record(failures: Array<{ bountyId: string; reason: string }>, runAt: Date) {
    if (failures.length === 0) return;
    const rows = failures.map(({ bountyId, reason }) => ({
      bounty_id: bountyId,
      reason: reason.slice(0, 1_000),
      run_at: runAt.toISOString()
    }));

    const { error } = await this.client.from('resolution_failures').insert(rows);
    // Deployments that have not received migration 0012 yet keep resolving
    // bounties; they simply have nowhere to file the failures.
    if (error) console.error('[OwlPay] could not record resolution failures', { message: error.message, count: rows.length });
  }
}
