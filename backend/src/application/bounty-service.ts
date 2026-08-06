import { createHash, randomUUID } from 'node:crypto';
import { parseUnits } from 'viem';
import { DomainError } from '../domain/errors.js';
import type { Bounty, BountyApplication, CreateApplicationInput, CreateBountyInput, ReviewPlan, SubmitWorkInput, VerificationInput } from '../domain/schemas.js';
import type { ApplicationRepository, BountyRepository, GitHubEvidenceProvider, PullRequestEvidence, ReviewPaymentVerifier, SettlementGateway } from './ports.js';
import type { VerificationPolicy } from './verification-policy.js';
import type { AuthUser } from './auth.js';

export class BountyService {
  constructor(
    private readonly repository: BountyRepository,
    private readonly applications: ApplicationRepository,
    private readonly github: GitHubEvidenceProvider,
    private readonly policy: VerificationPolicy,
    private readonly settlement: SettlementGateway = noopSettlementGateway,
    private readonly reviewPayments: ReviewPaymentVerifier = unavailableReviewPaymentVerifier,
    private readonly reviewConfig: ReviewConfig = defaultReviewConfig
  ) {}

  async list() {
    const bounties = await this.repository.list();
    const counts = await this.applications.countByBounties(bounties.map((bounty) => bounty.id));
    return bounties.map((bounty) => ({ ...bounty, applicantCount: counts[bounty.id] ?? 0 }));
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
    const counts = await this.applications.countByBounties([id]);
    return { ...bounty, applicantCount: counts[id] ?? 0 };
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
      ownerUserId: actor.id,
      applicantCount: 0,
      reviewPrice: input.reviewPlan === 'NONE'
        ? '0'
        : input.reviewPlan === 'SECURITY'
          ? this.reviewConfig.securityPrice
          : this.reviewConfig.standardPrice,
      reviewPaidAmount: '0',
      reviewPaymentStatus: input.reviewPlan === 'NONE' ? 'NOT_REQUIRED' : 'REQUIRED',
      reviewPaymentTxHashes: []
    };
    await this.repository.save(bounty);
    return bounty;
  }

  async getReviewPaymentRequirement(id: string, actor: AuthUser, requestedPlan?: ReviewPlan) {
    const bounty = await this.get(id);
    this.assertOwner(bounty, actor.id);
    const targetPlan = requirePaidReviewPlan(requestedPlan ?? bounty.reviewPlan);
    if (!this.reviewConfig.paymentToken || !this.reviewConfig.treasury) {
      throw new DomainError('Review payments are not configured yet', 503, 'REVIEW_PAYMENTS_NOT_CONFIGURED');
    }
    const payment = this.calculateReviewUpgrade(bounty, targetPlan);
    return {
      x402Version: 2,
      orderId: `${bounty.id}:${targetPlan}`,
      targetPlan,
      currentPaidAmount: bounty.reviewPaidAmount,
      paymentAmount: payment.amount,
      resource: {
        url: `/api/bounties/${bounty.id}/review-payment`,
        description: `${targetPlan === 'SECURITY' ? 'Security' : 'Standard'} Owl Agent review for ${bounty.title}`,
        mimeType: 'application/json'
      },
      accepts: [{
        scheme: 'exact',
        network: 'eip155:48816',
        amount: parseUnits(payment.amount, 6).toString(),
        asset: this.reviewConfig.paymentToken,
        payTo: this.reviewConfig.treasury,
        maxTimeoutSeconds: 900,
        extra: { name: 'OwlPay Test USDC', version: '1', decimals: 6 }
      }]
    };
  }

  async confirmReviewPayment(id: string, txHash: `0x${string}`, actor: AuthUser, requestedPlan?: ReviewPlan) {
    const bounty = await this.get(id);
    this.assertOwner(bounty, actor.id);
    const targetPlan = requirePaidReviewPlan(requestedPlan ?? bounty.reviewPlan);
    if (bounty.reviewPaymentTxHashes.some((hash) => hash.toLowerCase() === txHash.toLowerCase())) return bounty;
    if (actor.id !== bounty.ownerUserId || !this.reviewConfig.paymentToken || !this.reviewConfig.treasury) {
      throw new DomainError('Review payments are not configured yet', 503, 'REVIEW_PAYMENTS_NOT_CONFIGURED');
    }
    const payment = this.calculateReviewUpgrade(bounty, targetPlan);
    const reused = (await this.repository.list()).some((item) =>
      item.reviewPaymentTxHash?.toLowerCase() === txHash.toLowerCase()
      || item.reviewPaymentTxHashes.some((hash) => hash.toLowerCase() === txHash.toLowerCase())
    );
    if (reused) throw new DomainError('This transaction has already purchased a review', 409, 'PAYMENT_ALREADY_USED');
    await this.reviewPayments.verify({
      txHash,
      payer: bounty.ownerAddress as `0x${string}`,
      token: this.reviewConfig.paymentToken,
      payTo: this.reviewConfig.treasury,
      amount: parseUnits(payment.amount, 6)
    });
    const updated: Bounty = {
      ...bounty,
      reviewPlan: targetPlan,
      reviewPrice: payment.targetPrice,
      reviewPaidAmount: payment.targetPrice,
      reviewPaymentStatus: 'PAID',
      reviewPaymentTxHash: txHash,
      reviewPaymentTxHashes: [...bounty.reviewPaymentTxHashes, txHash],
      reviewPaidAt: new Date().toISOString()
    };
    await this.repository.save(updated);
    return updated;
  }

  async apply(id: string, input: CreateApplicationInput, actor: AuthUser): Promise<BountyApplication> {
    const bounty = await this.get(id);
    if (bounty.status !== 'OPEN') throw new DomainError('This bounty is not accepting applications', 409, 'APPLICATIONS_CLOSED');
    if (new Date(bounty.deadline).getTime() <= Date.now()) throw new DomainError('The bounty deadline has passed', 409, 'BOUNTY_EXPIRED');
    if (!actor.identityVerified || !actor.githubLogin) throw new DomainError('A verified GitHub identity is required', 403, 'GITHUB_IDENTITY_REQUIRED');
    if (bounty.ownerUserId === actor.id) throw new DomainError('The bounty owner cannot apply to their own bounty', 403, 'OWNER_CANNOT_APPLY');
    const existing = await this.applications.findByBountyAndDeveloper(id, actor.id);
    if (existing) throw new DomainError('You already applied to this bounty', 409, 'ALREADY_APPLIED');
    const now = new Date().toISOString();
    const application: BountyApplication = {
      id: randomUUID(),
      bountyId: id,
      developerUserId: actor.id,
      developerGithubLogin: actor.githubLogin,
      developerGithubAvatarUrl: actor.avatarUrl,
      developerAddress: input.developerAddress.toLowerCase(),
      message: input.message,
      status: 'PENDING',
      createdAt: now,
      updatedAt: now
    };
    await this.applications.save(application);
    return application;
  }

  async listApplications(id: string, actor: AuthUser) {
    const bounty = await this.get(id);
    this.assertOwner(bounty, actor.id);
    return this.applications.listByBounty(id);
  }

  async listMyApplications(actor: AuthUser) {
    const applications = await this.applications.listByDeveloper(actor.id);
    return Promise.all(applications.map(async (application) => ({ application, bounty: await this.get(application.bountyId) })));
  }

  async assign(id: string, applicationId: string, actor: AuthUser, assignmentTxHash?: string) {
    const bounty = await this.get(id);
    this.assertOwner(bounty, actor.id);
    if (bounty.status !== 'OPEN') throw new DomainError('Only an open bounty can be assigned', 409, 'BOUNTY_NOT_OPEN');
    const application = await this.applications.get(applicationId);
    if (!application || application.bountyId !== id) throw new DomainError('Application not found', 404, 'APPLICATION_NOT_FOUND');
    if (application.status !== 'PENDING') throw new DomainError('This application is no longer pending', 409, 'APPLICATION_RESOLVED');
    const updated: Bounty = {
      ...bounty,
      status: 'ASSIGNED',
      assignedDeveloperUserId: application.developerUserId,
      assignedDeveloperGithubLogin: application.developerGithubLogin,
      assignedDeveloperAddress: application.developerAddress,
      assignedAt: new Date().toISOString(),
      ...(assignmentTxHash ? { assignmentTxHash } : {})
    };
    await this.repository.save(updated);
    await this.applications.resolveAssignment(id, applicationId);
    return updated;
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

  async prepareSubmission(id: string, input: SubmitWorkInput, actor: AuthUser) {
    const bounty = await this.get(id);
    if (!['ASSIGNED', 'REVISION_REQUIRED'].includes(bounty.status)) {
      throw new DomainError('Bounty is not accepting submissions');
    }
    if (bounty.assignedDeveloperUserId !== actor.id) throw new DomainError('Only the assigned developer can submit work', 403, 'DEVELOPER_NOT_ASSIGNED');
    if (bounty.assignedDeveloperAddress?.toLowerCase() !== input.developerAddress.toLowerCase()) throw new DomainError('Use the wallet selected with your accepted application', 403, 'ASSIGNED_WALLET_MISMATCH');
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
    return { bounty, evidence, submissionHash: createSubmissionHash(evidence) };
  }

  async submit(id: string, input: SubmitWorkInput, actor: AuthUser) {
    const { bounty, evidence, submissionHash } = await this.prepareSubmission(id, input, actor);
    const updated: Bounty = {
      ...bounty,
      status: 'SUBMITTED',
      submission: {
        pullRequestUrl: input.pullRequestUrl,
        developerAddress: input.developerAddress,
        developerUserId: actor.id,
        commitSha: evidence.headSha,
        submissionHash,
        ...(input.submissionTxHash ? { submissionTxHash: input.submissionTxHash } : {}),
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
    if (input.commitSha && input.commitSha !== bounty.submission.commitSha) throw new DomainError('Agent report is bound to a different commit', 400, 'COMMIT_MISMATCH');
    if (bounty.reviewPlan === 'NONE') throw new DomainError('This bounty uses manual review', 409, 'MANUAL_REVIEW_SELECTED');
    if (bounty.reviewPaymentStatus !== 'PAID') throw new DomainError('The maintainer must purchase the review package first', 402, 'REVIEW_PAYMENT_REQUIRED');
    const decision = this.policy.decide(bounty.criteria, input);
    const updated: Bounty = {
      ...bounty,
      status: 'READY_FOR_REVIEW',
      reviewPaymentStatus: 'CONSUMED',
      reviewConsumedAt: new Date().toISOString(),
      decision
    };
    await this.repository.save(updated);
    return updated;
  }

  async runAutomatedReview(id: string, actor: AuthUser) {
    const bounty = await this.get(id);
    this.assertOwner(bounty, actor.id);
    return this.runPaidReview(id);
  }

  async runPaidReview(id: string) {
    const bounty = await this.get(id);
    if (bounty.status !== 'SUBMITTED' || !bounty.submission) {
      throw new DomainError('Bounty has no submission ready for review', 409, 'SUBMISSION_REQUIRED');
    }
    if (bounty.reviewPlan === 'NONE') throw new DomainError('This bounty uses manual review', 409, 'MANUAL_REVIEW_SELECTED');
    const input = await this.github.reviewPullRequest(bounty.submission.pullRequestUrl, bounty.criteria, bounty.reviewPlan);
    return this.verify(id, input);
  }

  async approve(id: string, actor: AuthUser) {
    const bounty = await this.get(id);
    this.assertOwner(bounty, actor.id);
    const manualReviewReady = bounty.reviewPlan === 'NONE' && bounty.status === 'SUBMITTED' && bounty.submission;
    const agentReviewReady = bounty.reviewPlan !== 'NONE' && bounty.status === 'READY_FOR_REVIEW' && bounty.decision;
    if (!manualReviewReady && !agentReviewReady) throw new DomainError('This bounty is not ready for maintainer approval', 409, 'NOT_READY_FOR_REVIEW');
    const payoutTxHash = await this.settlement.approveAndRelease(
      requireOnchainId(bounty, this.settlement.writesEnabled),
      bounty.decision ? hashDecision(bounty.decision) : hashManualDecision(bounty, 'APPROVE')
    );
    const updated: Bounty = payoutTxHash
      ? { ...bounty, status: 'PAID', payoutTxHash }
      : { ...bounty, status: 'APPROVED' };
    await this.repository.save(updated);
    return updated;
  }

  async requestRevision(id: string, actor: AuthUser) {
    const bounty = await this.get(id);
    this.assertOwner(bounty, actor.id);
    const manualReviewReady = bounty.reviewPlan === 'NONE' && bounty.status === 'SUBMITTED' && bounty.submission;
    const agentReviewReady = bounty.reviewPlan !== 'NONE' && bounty.status === 'READY_FOR_REVIEW' && bounty.decision;
    if (!manualReviewReady && !agentReviewReady) throw new DomainError('This bounty is not ready for maintainer review', 409, 'NOT_READY_FOR_REVIEW');
    await this.settlement.requestRevision(
      requireOnchainId(bounty, this.settlement.writesEnabled),
      bounty.decision ? hashDecision(bounty.decision) : hashManualDecision(bounty, 'REVISION_REQUIRED')
    );
    const updated: Bounty = { ...bounty, status: 'REVISION_REQUIRED' };
    await this.repository.save(updated);
    return updated;
  }

  async markPaid(id: string, payoutTxHash: string) {
    const bounty = await this.get(id);
    if (bounty.status !== 'APPROVED') throw new DomainError('Only an approved bounty can be paid', 409, 'NOT_APPROVED');
    const updated: Bounty = { ...bounty, status: 'PAID', payoutTxHash };
    await this.repository.save(updated);
    return updated;
  }

  private assertOwner(bounty: Bounty, actorUserId: string) {
    if (!bounty.ownerUserId || bounty.ownerUserId !== actorUserId) throw new DomainError('Only the bounty owner can perform this action', 403, 'FORBIDDEN');
  }

  private calculateReviewUpgrade(bounty: Bounty, targetPlan: Exclude<ReviewPlan, 'NONE'>) {
    if (bounty.reviewPaymentStatus === 'CONSUMED') {
      throw new DomainError('The purchased review has already been used', 409, 'REVIEW_ALREADY_CONSUMED');
    }
    const targetPrice = targetPlan === 'SECURITY' ? this.reviewConfig.securityPrice : this.reviewConfig.standardPrice;
    const targetUnits = parseUnits(targetPrice, 6);
    const paidUnits = parseUnits(bounty.reviewPaidAmount || '0', 6);
    if (targetUnits <= paidUnits) {
      throw new DomainError('This review level is already active', 409, 'REVIEW_ALREADY_PAID');
    }
    if (bounty.reviewPlan === 'SECURITY' && paidUnits > 0n && targetPlan === 'STANDARD') {
      throw new DomainError('A Security review cannot be downgraded', 409, 'REVIEW_DOWNGRADE_NOT_ALLOWED');
    }
    return { amount: formatTokenUnits(targetUnits - paidUnits), targetPrice };
  }
}

function normalizeRepository(value: string) {
  return value.replace(/\/$/, '').toLowerCase();
}

function createSubmissionHash(evidence: PullRequestEvidence): `0x${string}` {
  return `0x${createHash('sha256').update(`${evidence.pullRequestUrl}:${evidence.headSha}`).digest('hex')}`;
}

function hashDecision(decision: NonNullable<Bounty['decision']>): `0x${string}` {
  return `0x${createHash('sha256').update(JSON.stringify(decision)).digest('hex')}`;
}

function hashManualDecision(bounty: Bounty, action: 'APPROVE' | 'REVISION_REQUIRED'): `0x${string}` {
  return `0x${createHash('sha256').update(JSON.stringify({
    action,
    bountyId: bounty.id,
    commitSha: bounty.submission?.commitSha,
    reviewedBy: bounty.ownerUserId
  })).digest('hex')}`;
}

function requireOnchainId(bounty: Bounty, required: boolean) {
  if (bounty.onchainId && /^\d+$/.test(bounty.onchainId)) return bounty.onchainId;
  if (required) throw new DomainError('This bounty is not linked to a valid on-chain escrow', 409, 'ONCHAIN_BOUNTY_REQUIRED');
  return '';
}

const noopSettlementGateway: SettlementGateway = {
  writesEnabled: false,
  async approveAndRelease() { return null; },
  async requestRevision() { return null; }
};

export interface ReviewConfig {
  paymentToken: `0x${string}` | '';
  treasury: `0x${string}` | '';
  standardPrice: string;
  securityPrice: string;
}

const defaultReviewConfig: ReviewConfig = { paymentToken: '', treasury: '', standardPrice: '1', securityPrice: '2' };

const unavailableReviewPaymentVerifier: ReviewPaymentVerifier = {
  async verify() { throw new DomainError('Review payments are not configured yet', 503, 'REVIEW_PAYMENTS_NOT_CONFIGURED'); }
};

function requirePaidReviewPlan(plan: ReviewPlan): Exclude<ReviewPlan, 'NONE'> {
  if (plan === 'STANDARD' || plan === 'SECURITY') return plan;
  throw new DomainError('Choose Standard or Security to purchase an Owl Agent review', 400, 'PAID_REVIEW_PLAN_REQUIRED');
}

function formatTokenUnits(units: bigint) {
  const whole = units / 1_000_000n;
  const fraction = (units % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
