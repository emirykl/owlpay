import { createHash } from 'node:crypto';
import { DomainError } from '../domain/errors.js';
import type { Bounty } from '../domain/schemas.js';
import type { BountyRepository, GitHubEvidenceProvider, SettlementGateway } from './ports.js';
import type { VerificationPolicy } from './verification-policy.js';

const APPEAL_PERIOD_MS = 2 * 24 * 60 * 60 * 1_000;
const AUTO_PAYOUT_SCORE = 0.6;

/** Resolves elapsed contributor, maintainer-review and appeal windows. */
export class BountyResolutionService {
  constructor(
    private readonly repository: BountyRepository,
    private readonly github: GitHubEvidenceProvider,
    private readonly policy: VerificationPolicy,
    private readonly settlement: SettlementGateway
  ) {}

  async resolveDueBounties(now = Date.now()) {
    const bounties = await this.repository.listResolvable(new Date(now));
    const results: Array<{ id: string; status: Bounty['status']; resolution: Bounty['timeoutResolution'] }> = [];
    const errors: unknown[] = [];
    for (const bounty of bounties) {
      try {
        const updated = await this.resolveDueBounty(bounty, now);
        if (updated) results.push({ id: updated.id, status: updated.status, resolution: updated.timeoutResolution });
      } catch (error) {
        // One unavailable PR or settlement must not prevent other due bounties from resolving.
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, `${errors.length} due bounty resolution(s) failed`);
    return results;
  }

  private async resolveDueBounty(bounty: Bounty, now: number) {
    if (['OPEN', 'ASSIGNED', 'REVISION_REQUIRED'].includes(bounty.status)
      && now > new Date(bounty.contributorDeadline).getTime()) {
      const expired: Bounty = { ...bounty, status: 'EXPIRED' };
      await this.repository.save(expired);
      return expired;
    }
    if (bounty.timeoutResolution === 'AUTO_FAILED_PENDING' && bounty.appealDeadline && now > new Date(bounty.appealDeadline).getTime()) {
      const resolutionHash = hashTimeoutResolution(bounty, 'AUTO_REFUNDED');
      const refundTxHash = await this.settlement.refundAfterTimeout(
        requireOnchainId(bounty, this.settlement.writesEnabled),
        resolutionHash,
        bounty.escrowContractAddress
      );
      const refunded: Bounty = {
        ...bounty,
        status: 'REFUNDED',
        timeoutResolution: 'AUTO_REFUNDED',
        timeoutResolvedAt: new Date(now).toISOString(),
        ...(refundTxHash ? { refundTxHash } : {})
      };
      await this.repository.save(refunded);
      return refunded;
    }
    if (!bounty.submission || !['SUBMITTED', 'VERIFYING', 'READY_FOR_REVIEW'].includes(bounty.status)) return null;
    if (now <= new Date(bounty.maintainerReviewDeadline).getTime()) return null;

    const pullRequest = await this.github.getPullRequest(bounty.submission.pullRequestUrl);
    const commitMatches = pullRequest.headSha === bounty.submission.commitSha;
    if (pullRequest.merged && commitMatches) {
      const verificationHash = hashTimeoutResolution(bounty, 'MERGED');
      const payoutTxHash = await this.settlement.approveAfterTimeout(
        requireOnchainId(bounty, this.settlement.writesEnabled),
        verificationHash,
        bounty.escrowContractAddress
      );
      const paid: Bounty = {
        ...bounty,
        status: payoutTxHash ? 'PAID' : 'APPROVED',
        timeoutResolution: 'AUTO_APPROVED',
        timeoutResolvedAt: new Date(now).toISOString(),
        ...(payoutTxHash ? { payoutTxHash } : {})
      };
      await this.repository.save(paid);
      return paid;
    }

    // Manual-review maintainers never consented to an agent settlement.
    if (bounty.reviewPlan === 'NONE') {
      const unreviewed: Bounty = {
        ...bounty,
        status: 'HUMAN_REVIEW',
        timeoutResolution: 'INCONCLUSIVE',
        timeoutResolvedAt: new Date(now).toISOString()
      };
      await this.repository.save(unreviewed);
      return unreviewed;
    }

    let decision = bounty.decision;
    if (!decision || !commitMatches) {
      const input = await this.github.reviewPullRequest(
        bounty.submission.pullRequestUrl,
        bounty.criteria,
        bounty.reviewPlan,
        {
          bountyTitle: bounty.title,
          bountyDescription: bounty.description,
          safetyIdentifier: createHash('sha256').update(bounty.ownerUserId ?? bounty.ownerAddress).digest('hex')
        }
      );
      decision = this.policy.decide(bounty.criteria, input);
    }

    // Agent output is evidence, never settlement authority. Only an actual
    // matching GitHub merge can release escrow automatically.
    const explicitFailure = decisionScore(decision) < AUTO_PAYOUT_SCORE * 100
      || decision.taskAssessment?.status === 'NOT_MET'
      || decision.taskAssessment?.status === 'PARTIALLY_MET'
      || decision.blockingIssues.length > 0
      || hasFailedMandatoryCriterion(bounty, decision);
    const unresolved: Bounty = explicitFailure
      ? {
          ...bounty,
          decision,
          status: 'HUMAN_REVIEW',
          timeoutResolution: 'AUTO_FAILED_PENDING',
          timeoutResolvedAt: new Date(now).toISOString(),
          appealDeadline: new Date(now + APPEAL_PERIOD_MS).toISOString()
        }
      : {
          ...bounty,
          decision,
          status: 'HUMAN_REVIEW',
          timeoutResolution: 'INCONCLUSIVE',
          timeoutResolvedAt: new Date(now).toISOString()
        };
    await this.repository.save(unresolved);
    return unresolved;
  }
}

function decisionScore(decision: NonNullable<Bounty['decision']>) {
  return decision.score ?? decision.taskAssessment?.score ?? Math.round(decision.confidence * 100);
}

function hasFailedMandatoryCriterion(bounty: Bounty, decision: NonNullable<Bounty['decision']>) {
  const resultById = new Map(decision.criterionResults.map((result) => [result.criterionId, result]));
  return bounty.criteria.some((criterion) => criterion.mandatory && resultById.get(criterion.id)?.status === 'FAILED');
}

function hashTimeoutResolution(bounty: Bounty, resolution: string): `0x${string}` {
  return `0x${createHash('sha256').update(JSON.stringify({
    action: resolution,
    bountyId: bounty.id,
    commitSha: bounty.submission?.commitSha,
    maintainerReviewDeadline: bounty.maintainerReviewDeadline,
    decision: bounty.decision
  })).digest('hex')}`;
}

function requireOnchainId(bounty: Bounty, required: boolean) {
  if (bounty.onchainId && /^\d+$/.test(bounty.onchainId)) return bounty.onchainId;
  if (required) throw new DomainError('This bounty is not linked to a valid on-chain escrow', 409, 'ONCHAIN_BOUNTY_REQUIRED');
  return '';
}
