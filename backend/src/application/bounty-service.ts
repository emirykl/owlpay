import { randomUUID } from 'node:crypto';
import { DomainError } from '../domain/errors.js';
import type { Bounty, CreateBountyInput, SubmitWorkInput, VerificationInput } from '../domain/schemas.js';
import type { BountyRepository, GitHubEvidenceProvider } from './ports.js';
import type { VerificationPolicy } from './verification-policy.js';
import type { AuthUser } from './auth.js';

export class BountyService {
  constructor(
    private readonly repository: BountyRepository,
    private readonly github: GitHubEvidenceProvider,
    private readonly policy: VerificationPolicy
  ) {}

  list() {
    return this.repository.list();
  }

  listManageableRepositories(actor: AuthUser, providerToken: string) {
    if (!actor.identityVerified || !actor.githubId) {
      throw new DomainError('A verified GitHub identity is required', 403, 'GITHUB_IDENTITY_REQUIRED');
    }
    return this.github.listManageableRepositories(providerToken, actor.githubId);
  }

  async get(id: string) {
    const bounty = await this.repository.get(id);
    if (!bounty) throw new DomainError('Bounty not found', 404, 'BOUNTY_NOT_FOUND');
    return bounty;
  }

  async create(input: CreateBountyInput, actor: AuthUser, providerToken: string): Promise<Bounty> {
    const repository = actor.identityVerified && actor.githubId
      ? await this.github.assertCanManageRepository(input.repositoryUrl, providerToken, actor.githubId)
      : null;
    const bounty: Bounty = {
      ...input,
      repositoryUrl: repository?.url ?? input.repositoryUrl,
      id: randomUUID(),
      status: 'DRAFT',
      createdAt: new Date().toISOString(),
      ownerUserId: actor.id
    };
    await this.repository.save(bounty);
    return bounty;
  }

  async markFunded(id: string, onchainId: string, fundingTxHash: string, actorUserId?: string) {
    const bounty = await this.get(id);
    if (bounty.ownerUserId && bounty.ownerUserId !== actorUserId) {
      throw new DomainError('Only the bounty owner can record funding', 403, 'FORBIDDEN');
    }
    if (bounty.status !== 'DRAFT') throw new DomainError('Only a draft bounty can be funded');
    const updated: Bounty = { ...bounty, status: 'OPEN', onchainId, fundingTxHash };
    await this.repository.save(updated);
    return updated;
  }

  async submit(id: string, input: SubmitWorkInput, actor: AuthUser) {
    const bounty = await this.get(id);
    if (!['OPEN', 'REVISION_REQUIRED'].includes(bounty.status)) {
      throw new DomainError('Bounty is not accepting submissions');
    }
    if (actor.identityVerified && bounty.ownerUserId === actor.id) {
      throw new DomainError('A bounty owner cannot submit work to their own bounty', 403, 'OWNER_CANNOT_SUBMIT');
    }
    const evidence = await this.github.getPullRequest(input.pullRequestUrl);
    if (normalizeRepository(evidence.repositoryUrl) !== normalizeRepository(bounty.repositoryUrl)) {
      throw new DomainError('Pull request belongs to a different repository', 400, 'WRONG_REPOSITORY');
    }
    if (evidence.state !== 'open') {
      throw new DomainError('The pull request must be open', 400, 'PULL_REQUEST_NOT_OPEN');
    }
    if (actor.identityVerified && (!actor.githubId || actor.githubId !== evidence.authorId)) {
      throw new DomainError('The signed-in GitHub user must own the pull request', 403, 'PR_OWNER_MISMATCH');
    }
    if (bounty.submission?.developerUserId && bounty.submission.developerUserId !== actor.id) {
      throw new DomainError('Only the original developer can submit a revision', 403, 'DEVELOPER_MISMATCH');
    }
    const updated: Bounty = {
      ...bounty,
      status: 'SUBMITTED',
      submission: {
        ...input,
        developerUserId: actor.id,
        commitSha: evidence.headSha,
        submittedAt: new Date().toISOString()
      }
    };
    delete updated.decision;
    await this.repository.save(updated);
    return { bounty: updated, evidence };
  }

  async verify(id: string, input: VerificationInput) {
    const bounty = await this.get(id);
    if (bounty.status !== 'SUBMITTED' || !bounty.submission) {
      throw new DomainError('Bounty has no submission ready for verification');
    }
    if (input.paidVerification && input.paidVerification.commitSha !== bounty.submission.commitSha) {
      throw new DomainError('Paid report is bound to a different commit', 400, 'COMMIT_MISMATCH');
    }
    if (input.paidVerification && Number(input.paidVerification.price) > Number(bounty.verificationBudget)) {
      throw new DomainError('Paid verification exceeds the bounty budget', 400, 'BUDGET_EXCEEDED');
    }
    const decision = this.policy.decide(bounty.criteria, input);
    const status = decision.decision === 'APPROVE'
      ? 'APPROVED'
      : decision.decision === 'REVISION_REQUIRED'
        ? 'REVISION_REQUIRED'
        : 'HUMAN_REVIEW';
    const updated: Bounty = { ...bounty, status, decision };
    await this.repository.save(updated);
    return updated;
  }
}

function normalizeRepository(value: string) {
  return value.replace(/\/$/, '').toLowerCase();
}
