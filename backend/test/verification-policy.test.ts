import { describe, expect, it } from 'vitest';
import { VerificationPolicy } from '../src/application/verification-policy.js';

const criteria = [
  { id: 'health', description: 'Health endpoint returns 200', mandatory: true, method: 'ci' as const },
  { id: 'readme', description: 'README is updated', mandatory: true, method: 'github' as const }
];

describe('VerificationPolicy', () => {
  it('approves only complete high-confidence evidence', () => {
    const decision = new VerificationPolicy().decide(criteria, {
      confidence: 0.94,
      blockingIssues: [],
      criterionResults: criteria.map((criterion) => ({
        criterionId: criterion.id,
        status: 'PASSED' as const,
        evidence: ['commit:abc'],
        summary: 'Passed'
      }))
    });
    expect(decision.decision).toBe('APPROVE');
  });

  it('escalates low-confidence evidence', () => {
    const decision = new VerificationPolicy().decide(criteria, {
      confidence: 0.7,
      blockingIssues: [],
      criterionResults: criteria.map((criterion) => ({
        criterionId: criterion.id,
        status: 'PASSED' as const,
        evidence: ['commit:abc'],
        summary: 'Passed'
      }))
    });
    expect(decision.decision).toBe('HUMAN_REVIEW');
  });

  it('requires revision for a failed mandatory criterion', () => {
    const decision = new VerificationPolicy().decide(criteria, {
      confidence: 0.99,
      blockingIssues: [],
      criterionResults: [{ criterionId: 'health', status: 'FAILED', evidence: ['ci:failed'], summary: 'Failed' }]
    });
    expect(decision.decision).toBe('REVISION_REQUIRED');
  });
});

