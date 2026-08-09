import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import type { Bounty } from '@/lib/api';
import { owlpayApi } from '@/lib/api';
import { ArrowUpRight, Check } from './icons';

type AgentDecision = NonNullable<Bounty['decision']>;

export function AgentReportCard({ decision, onOpen }: { decision: AgentDecision; onOpen: () => void }) {
  const score = agentTaskScore(decision);
  const tone = reportScoreTone(score);
  return (
    <article className={`agentReportCard reportTone-${tone}`}>
      <ReportGauge score={score} />
      <div className="agentReportSummary">
        <span>Owl AI task score</span>
        <h3>{formatDecision(decision.decision)}</h3>
        <small>{reportScoreLabel(score, decision.taskAssessment?.status)}</small>
      </div>
      <button type="button" className="agentReportButton" onClick={onOpen}>View report <ArrowUpRight /></button>
    </article>
  );
}

function ReportGauge({ score }: { score: number }) {
  const needleRotation = (Math.min(100, Math.max(0, score)) - 50) * 1.8;
  return (
    <div className="reportGauge" role="img" aria-label={`Owl AI task completion score ${score} out of 100`}>
      <svg viewBox="0 0 200 145" aria-hidden="true">
        <path className="reportGaugeTrack" d="M16 100 A84 84 0 0 1 184 100" pathLength="100" />
        <path className="reportGaugeSegment gaugeRed" d="M16 100 A84 84 0 0 1 50.63 32.04" />
        <path className="reportGaugeSegment gaugeYellow" d="M50.63 32.04 A84 84 0 0 1 125.96 20.11" />
        <path className="reportGaugeSegment gaugeGreen" d="M125.96 20.11 A84 84 0 0 1 184 100" />
        <g className="reportGaugeNeedle" style={{ transform: `rotate(${needleRotation}deg)`, transformOrigin: '100px 100px' }}>
          <line x1="100" y1="100" x2="100" y2="20" />
          <circle className="reportGaugeTip" cx="100" cy="16" r="6" />
        </g>
        <circle className="reportGaugePivot" cx="100" cy="100" r="8" />
        <text className="reportGaugeValue" x="100" y="138" textAnchor="middle"><tspan>{score}</tspan><tspan> /100</tspan></text>
      </svg>
    </div>
  );
}

export function AgentReportModal({ bountyId, criteria, decision, submission, onClose }: { bountyId: string; criteria: Bounty['criteria']; decision: AgentDecision; submission?: Bounty['submission']; onClose: () => void }) {
  const score = agentTaskScore(decision);
  const resultById = new Map((decision.criterionResults ?? []).map((result) => [result.criterionId, result]));
  const results = [...resultById.values()];
  const passedCount = results.filter((result) => result.status === 'PASSED').length;
  const evidenceCount = new Set(results.flatMap((result) => result.evidence)).size;
  const reportEvidence = useQuery({
    queryKey: ['submission-report-evidence', bountyId, submission?.commitSha],
    queryFn: () => owlpayApi.getSubmissionReportEvidence(bountyId),
    enabled: Boolean(submission),
    retry: false
  });
  const changedFiles = reportEvidence.data?.changedFiles ?? submission?.changedFiles;
  const additions = reportEvidence.data?.additions ?? submission?.additions ?? 0;
  const deletions = reportEvidence.data?.deletions ?? submission?.deletions ?? 0;
  return (
    <motion.div className="agentReportBackdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .18 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <motion.section className="agentReportModal" role="dialog" aria-modal="true" aria-labelledby="agent-report-title" initial={{ opacity: 0, y: 16, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: .98 }} transition={{ type: 'spring', stiffness: 380, damping: 31 }}>
        <button type="button" className="iconButton agentReportClose" aria-label="Close Owl AI report" onClick={onClose}>×</button>
        <header className="agentReportModalHeader"><span>Owl AI Agent</span><h2 id="agent-report-title">Review report</h2></header>
        <div className="agentReportOverview">
          <ReportGauge score={score} />
          <div><span>Task assessment</span><strong>{reportScoreLabel(score, decision.taskAssessment?.status)}</strong><small>Recommendation: {formatDecision(decision.decision)}</small></div>
        </div>
        <div className="agentReportStats">
          <div><span>Evidence confidence</span><strong>{Math.round(decision.confidence * 100)}%</strong></div>
          <div><span>Criteria passed</span><strong>{passedCount}/{criteria.length}</strong></div>
          <div><span>Blocking issues</span><strong>{decision.blockingIssues.length}</strong></div>
          <div><span>{changedFiles === undefined ? 'Commit' : 'Changes reviewed'}</span><strong>{changedFiles === undefined ? reportEvidence.isLoading ? 'Loading…' : submission?.commitSha.slice(0, 8) ?? '—' : `${changedFiles} files · +${additions} −${deletions}`}</strong></div>
        </div>
        {decision.taskAssessment && <section className="agentCriteriaReport" aria-labelledby="agent-task-title">
          <div className="agentCriteriaHeader"><h3 id="agent-task-title">Bounty task</h3><span>{decision.taskAssessment.evidence.length || evidenceCount} evidence source(s)</span></div>
          <div className="agentCriteriaList">
            <article className={`agentCriterion task-${decision.taskAssessment.status.toLowerCase()}`}>
              <span className="agentCriterionStatus">{decision.taskAssessment.status === 'FULLY_MET' || decision.taskAssessment.status === 'MOSTLY_MET' ? <Check /> : decision.taskAssessment.status === 'UNKNOWN' ? '?' : '!'}</span>
              <div><strong>{reportScoreLabel(score, decision.taskAssessment.status)}</strong><p>{decision.taskAssessment.summary}</p></div>
              <small>{score}/100</small>
            </article>
          </div>
        </section>}
        <section className="agentCriteriaReport" aria-labelledby="agent-criteria-title">
          <div className="agentCriteriaHeader"><h3 id="agent-criteria-title">Criteria</h3><span>{criteria.length} checked</span></div>
          <div className="agentCriteriaList">
            {criteria.map((criterion) => {
              const result = resultById.get(criterion.id);
              const status = result?.status ?? 'UNKNOWN';
              return <article className={`agentCriterion criterion-${status.toLowerCase()}`} key={criterion.id}><span className="agentCriterionStatus">{status === 'PASSED' ? <Check /> : status === 'FAILED' ? '!' : '?'}</span><div><strong>{criterion.description}</strong><p>{result?.summary ?? 'No conclusive evidence was returned.'}</p></div><small>{status === 'PASSED' ? 'Passed' : status === 'FAILED' ? 'Failed' : 'Needs review'}</small></article>;
            })}
          </div>
        </section>
        {decision.blockingIssues.length > 0 && <section className="agentBlockingIssues"><h3>Blocking issues</h3>{decision.blockingIssues.map((issue) => <p key={issue}>{issue}</p>)}</section>}
      </motion.section>
    </motion.div>
  );
}

function reportScoreTone(score: number) {
  if (score >= 60) return 'green';
  if (score >= 30) return 'yellow';
  return 'red';
}

function reportScoreLabel(score: number, status?: NonNullable<AgentDecision['taskAssessment']>['status']) {
  if (status === 'UNKNOWN') return 'Needs task evidence';
  if (score >= 85) return 'Task fully met';
  if (score >= 60) return 'Task mostly met';
  if (score >= 30) return 'Task partially met';
  return 'Task not met';
}

function agentTaskScore(decision: AgentDecision) {
  return decision.score ?? decision.taskAssessment?.score ?? Math.round(decision.confidence * 100);
}

function formatDecision(decision: AgentDecision['decision']) {
  if (decision === 'APPROVE') return 'Approve';
  if (decision === 'REVISION_REQUIRED') return 'Revision required';
  return 'Human review';
}

export function ReviewPackageInfoModal({ plan, onClose }: { plan: 'STANDARD' | 'SECURITY'; onClose: () => void }) {
  const isSecurity = plan === 'SECURITY';
  const checks = isSecurity
    ? ['All Standard checks', 'Deep pull-request diff analysis', 'Security and secret risk signals']
    : ['Acceptance criteria', 'Pull request and commit evidence', 'Optional GitHub CI checks'];
  return (
    <motion.div className="reviewInfoBackdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .18 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <motion.section className={`reviewInfoModal ${isSecurity ? 'securityReviewInfoModal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="review-info-title" initial={{ opacity: 0, y: 16, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: .98 }} transition={{ type: 'spring', stiffness: 380, damping: 31 }}>
        <button type="button" className="iconButton reviewInfoClose" aria-label="Close review details" onClick={onClose}>×</button>
        <span className="reviewInfoEyebrow">Owl AI Agent</span>
        <div className="reviewInfoHero">
          <span className="reviewPackageLogo"><ReviewOwlLogo tone={isSecurity ? 'security' : 'standard'} /></span>
          <h3 id="review-info-title">{isSecurity ? 'Security review' : 'Standard review'}</h3>
        </div>
        <div className="reviewInfoChecks">{checks.map((check, index) => <div key={check}><span>{index + 1}</span><strong>{check}</strong></div>)}</div>
      </motion.section>
    </motion.div>
  );
}

export function ReviewOwlLogo({ tone }: { tone: 'standard' | 'security' }) {
  const filterId = `review-owl-${tone}`;
  const color = tone === 'security' ? [0.72, 0.46, 0.02] : [0.34, 0.38, 0.44];
  return (
    <svg viewBox="300 140 650 960" aria-hidden="true">
      <defs>
        <filter id={filterId} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={`0 0 0 0 ${color[0]} 0 0 0 0 ${color[1]} 0 0 0 0 ${color[2]} -0.2126 -0.7152 -0.0722 0 1`} />
        </filter>
      </defs>
      <image href="/owlpay-logo.png" width="1254" height="1254" filter={`url(#${filterId})`} />
    </svg>
  );
}
