import { describe, expect, it } from 'vitest';
import { getBountyDeadlineState } from './bounty-deadline';

describe('getBountyDeadlineState', () => {
  const now = new Date('2026-08-06T00:00:00.000Z').getTime();

  it('uses days only when at least a day remains', () => {
    expect(getBountyDeadlineState('2026-08-07T00:00:00.000Z', now).label).toBe('1 day left');
  });

  it('shows hours when less than a day remains', () => {
    expect(getBountyDeadlineState('2026-08-06T03:00:00.000Z', now).label).toBe('3 hours left');
  });

  it('shows minutes when less than an hour remains', () => {
    expect(getBountyDeadlineState('2026-08-06T00:42:00.000Z', now).label).toBe('42 minutes left');
  });

  it('closes at the deadline', () => {
    expect(getBountyDeadlineState('2026-08-06T00:00:00.000Z', now)).toEqual({ closed: true, label: 'Closed' });
  });
});
