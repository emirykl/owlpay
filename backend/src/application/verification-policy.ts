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
    const taskAssessment = input.taskAssessment;
    const taskFailed = Boolean(taskAssessment && (
      taskAssessment.status === 'NOT_MET'
      || taskAssessment.status === 'PARTIALLY_MET'
      || taskAssessment.score < 60
    ));
    const taskUnknown = taskAssessment?.status === 'UNKNOWN';

    const blockingIssues = [...input.blockingIssues];
    for (const criterion of missingMandatory) blockingIssues.push(`Missing evidence: ${criterion.description}`);
    for (const criterion of failedMandatory) blockingIssues.push(`Failed: ${criterion.description}`);
    if (taskFailed && taskAssessment) blockingIssues.push(`Task requirements not sufficiently met: ${taskAssessment.summary}`);

    let decision: AgentDecision['decision'];
    if (taskFailed || failedMandatory.length > 0 || input.blockingIssues.length > 0) {
      decision = 'REVISION_REQUIRED';
    } else if (taskUnknown || missingMandatory.length > 0 || unknownMandatory.length > 0 || input.confidence < 0.9) {
      decision = 'HUMAN_REVIEW';
    } else {
      decision = 'APPROVE';
    }

    return {
      decision,
      confidence: input.confidence,
      score: taskAssessment?.score ?? Math.round(input.confidence * 100),
      ...(taskAssessment ? { taskAssessment } : {}),
      summary: decision === 'APPROVE'
        ? 'The task requirements and every mandatory criterion passed the settlement gate.'
        : decision === 'REVISION_REQUIRED'
          ? taskFailed
            ? 'The submitted changes do not sufficiently fulfill the bounty task.'
            : 'One or more blocking conditions require a new submission.'
          : 'The evidence is incomplete or confidence is below the automatic settlement threshold.',
      blockingIssues,
      criterionResults: input.criterionResults,
      decidedAt: new Date().toISOString()
    };
  }
}
