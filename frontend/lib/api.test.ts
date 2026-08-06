import { describe, expect, it } from 'vitest';
import { formatApiError } from './api';

describe('formatApiError', () => {
  it('shows the field and validation detail returned by the API', () => {
    expect(formatApiError({
      message: 'Request validation failed',
      issues: [{ path: ['deadline'], message: 'Deadline must be in the future' }]
    }, 400)).toBe('deadline: Deadline must be in the future');
  });

  it('falls back to the API message when no issue detail exists', () => {
    expect(formatApiError({ message: 'Request failed' }, 400)).toBe('Request failed');
  });
});
