import type { ResolutionFailureLog } from '../application/ports.js';

export interface RecordedResolutionFailure {
  bountyId: string;
  reason: string;
  runAt: string;
}

/**
 * Keeps the most recent failures in process for local runs. Bounded so a host
 * left running for weeks cannot grow this without limit.
 */
export class InMemoryResolutionFailureLog implements ResolutionFailureLog {
  private readonly recorded: RecordedResolutionFailure[] = [];

  constructor(private readonly limit = 200) {}

  async record(failures: Array<{ bountyId: string; reason: string }>, runAt: Date) {
    for (const failure of failures) {
      this.recorded.push({ ...failure, runAt: runAt.toISOString() });
    }
    if (this.recorded.length > this.limit) this.recorded.splice(0, this.recorded.length - this.limit);
  }

  list(): RecordedResolutionFailure[] {
    return [...this.recorded];
  }
}
