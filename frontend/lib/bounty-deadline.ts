const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface BountyDeadlineState {
  closed: boolean;
  label: string;
}

export function getBountyDeadlineState(deadline: string, now = Date.now()): BountyDeadlineState {
  const remaining = new Date(deadline).getTime() - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return { closed: true, label: 'Closed' };

  if (remaining < HOUR) {
    const minutes = Math.max(1, Math.ceil(remaining / MINUTE));
    return { closed: false, label: `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left` };
  }

  if (remaining < DAY) {
    const hours = Math.ceil(remaining / HOUR);
    return { closed: false, label: `${hours} ${hours === 1 ? 'hour' : 'hours'} left` };
  }

  const days = Math.ceil(remaining / DAY);
  return { closed: false, label: `${days} ${days === 1 ? 'day' : 'days'} left` };
}
