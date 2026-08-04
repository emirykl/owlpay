import type { AgentDecision, Criterion, VerificationInput } from '../domain/schemas.js';

export class VerificationPolicy {
  decide(criteria: Criterion[], input: VerificationInput): AgentDecision {
    const resultById = new Map(input.criterionResults.map((result) => [result.criterionId, result]));
    const missingMandatory = criteria.filter((criterion) => criterion.mandatory && !resultById.has(criterion.id));
    const failedMandatory = criteria.filter((criterion) => {
      const result = resultById.get(criterion.id);
      return criterion.mandatory && result?.status === 'FAILED';
    });
    const unknownMandatory = criteria.filter((criterion) => {
      const result = resultById.get(criterion.id);
      return criterion.mandatory && result?.status === 'UNKNOWN';
    });

    const blockingIssues = [...input.blockingIssues];
    for (const criterion of missingMandatory) blockingIssues.push(`Missing evidence: ${criterion.description}`);
    for (const criterion of failedMandatory) blockingIssues.push(`Failed: ${criterion.description}`);

    let decision: AgentDecision['decision'];
    if (failedMandatory.length > 0 || input.blockingIssues.length > 0) {
      decision = 'REVISION_REQUIRED';
    } else if (missingMandatory.length > 0 || unknownMandatory.length > 0 || input.confidence < 0.9) {
      decision = 'HUMAN_REVIEW';
    } else {
      decision = 'APPROVE';
    }

    return {
      decision,
      confidence: input.confidence,
      summary: decision === 'APPROVE'
        ? 'Every mandatory criterion has passed the deterministic settlement gate.'
        : decision === 'REVISION_REQUIRED'
          ? 'One or more blocking conditions require a new submission.'
          : 'The evidence is incomplete or confidence is below the automatic settlement threshold.',
      blockingIssues,
      criterionResults: input.criterionResults,
      decidedAt: new Date().toISOString()
    };
  }
}

