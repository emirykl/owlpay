import { describe, expect, it } from 'vitest';
import type { Bounty } from '../src/domain/schemas.js';
import { bountyForViewer } from '../src/application/bounty-visibility.js';

const bounty = {
  ownerUserId: 'maintainer',
  decision: {
    decision: 'HUMAN_REVIEW',
    confidence: 0.82,
    score: 85,
    summary: 'Maintainer-only Owl AI report.',
    blockingIssues: [],
    criterionResults: [],
    decidedAt: new Date().toISOString()
  }
} as unknown as Bounty;

describe('bountyForViewer', () => {
  it('keeps the Owl AI report for the maintainer', () => {
    expect(bountyForViewer(bounty, 'maintainer').decision?.score).toBe(85);
  });

  it('removes the Owl AI report for contributors and public viewers', () => {
    expect(bountyForViewer(bounty, 'contributor').decision).toBeUndefined();
    expect(bountyForViewer(bounty, null).decision).toBeUndefined();
  });
});
