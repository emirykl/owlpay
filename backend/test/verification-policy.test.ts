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
      taskAssessment: { status: 'FULLY_MET', score: 95, evidence: ['file:src/app.ts'], summary: 'The task is fulfilled.' },
      blockingIssues: [],
      criterionResults: criteria.map((criterion) => ({
        criterionId: criterion.id,
        status: 'PASSED' as const,
        evidence: ['commit:abc'],
        summary: 'Passed'
      }))
    });
    expect(decision.decision).toBe('APPROVE');
    expect(decision.score).toBe(95);
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

  it('requires revision when the patch only partially fulfills the bounty task', () => {
    const decision = new VerificationPolicy().decide(criteria, {
      confidence: 0.96,
      taskAssessment: { status: 'PARTIALLY_MET', score: 45, evidence: ['file:README.md'], summary: 'Only one of two requested lines was added.' },
      blockingIssues: [],
      criterionResults: criteria.map((criterion) => ({
        criterionId: criterion.id,
        status: 'PASSED' as const,
        evidence: ['commit:abc'],
        summary: 'Passed'
      }))
    });

    expect(decision.decision).toBe('REVISION_REQUIRED');
    expect(decision.blockingIssues[0]).toContain('Task requirements not sufficiently met');
  });

  it('keeps a high task score in human review when mandatory CI evidence is missing', () => {
    const decision = new VerificationPolicy().decide(criteria, {
      confidence: 0.82,
      taskAssessment: { status: 'FULLY_MET', score: 94, evidence: ['file:README.md'], summary: 'The requested README change is present.' },
      blockingIssues: [],
      criterionResults: [
        { criterionId: 'health', status: 'UNKNOWN', evidence: ['commit:abc'], summary: 'No CI run was available.' },
        { criterionId: 'readme', status: 'PASSED', evidence: ['file:README.md'], summary: 'Passed' }
      ]
    });

    expect(decision.decision).toBe('HUMAN_REVIEW');
    expect(decision.score).toBe(94);
  });
});
