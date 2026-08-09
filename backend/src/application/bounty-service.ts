import { createHash, randomUUID } from 'node:crypto';
import { parseUnits } from 'viem';
import { DomainError } from '../domain/errors.js';
import type { Bounty, BountyApplication, CreateApplicationInput, CreateBountyInput, RequestRevisionInput, ReviewPlan, RevisionRequest, SubmitWorkInput, VerificationInput } from '../domain/schemas.js';
import type { ApplicationRepository, BountyRepository, GitHubEvidenceProvider, PullRequestEvidence, ReviewPaymentGateway, ReviewPaymentVerifier, SettlementGateway } from './ports.js';
import type { VerificationPolicy } from './verification-policy.js';
import type { AuthUser } from './auth.js';
import { BountyResolutionService } from './bounty-resolution-service.js';
import {
  assertConfirmedReviewOrder,
  assertCreatedReviewOrder,
  assertReviewPaymentProof,
  calculateReviewUpgrade,
  defaultReviewConfig,
  type ReviewConfig
} from './review-payment-policy.js';

export type { ReviewConfig } from './review-payment-policy.js';

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAINTAINER_REVIEW_PERIOD_MS = 7 * DAY_MS;
const REVISION_RESPONSE_PERIOD_MS = 2 * DAY_MS;
const MAX_REVISIONS = 2;
const MAX_PENDING_APPLICATIONS = 5;
const MARKETPLACE_PAGE_SIZE = 200;

export class BountyService {
  private readonly resolutions: BountyResolutionService;

  constructor(
    private readonly repository: BountyRepository,
    private readonly applications: ApplicationRepository,
    private readonly github: GitHubEvidenceProvider,
    private readonly policy: VerificationPolicy,
    private readonly settlement: SettlementGateway = noopSettlementGateway,
    private readonly reviewPaymentGateway: ReviewPaymentGateway = unavailableReviewPaymentGateway,
    private readonly reviewPayments: ReviewPaymentVerifier = unavailableReviewPaymentVerifier,
    private readonly reviewConfig: ReviewConfig = defaultReviewConfig,
    private readonly settlementConfig: SettlementConfig = defaultSettlementConfig
  ) {
    this.resolutions = new BountyResolutionService(repository, github, policy, settlement);
  }

  async list() {
    const bounties = await this.repository.list(MARKETPLACE_PAGE_SIZE);
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
      reviewPaymentTxHashes: [],
      reviewPaymentOrderIds: [],
      revisionRequests: [],
      contributorDeadline: input.deadline,
      maintainerReviewDeadline: new Date(new Date(input.deadline).getTime() + MAINTAINER_REVIEW_PERIOD_MS).toISOString(),
      revisionExtensionUsed: false,
      timeoutResolution: 'NONE'
    };
    if (this.settlementConfig.escrowContractAddress) {
      bounty.escrowContractAddress = this.settlementConfig.escrowContractAddress.toLowerCase();
    }
    await this.repository.save(bounty);
    return bounty;
  }

  async createReviewPaymentOrder(id: string, actor: AuthUser, requestedPlan?: ReviewPlan) {
    const bounty = await this.get(id);
    this.assertOwner(bounty, actor.id);
    const targetPlan = requirePaidReviewPlan(requestedPlan ?? bounty.reviewPlan);
    if (!this.reviewConfig.paymentToken || !this.reviewPaymentGateway.configured) {
      throw new DomainError('Review payments are not configured yet', 503, 'REVIEW_PAYMENTS_NOT_CONFIGURED');
    }
    const payment = calculateReviewUpgrade(bounty, targetPlan, this.reviewConfig);
    const amountWei = parseUnits(payment.amount, this.reviewConfig.tokenDecimals).toString();
    const payer = bounty.ownerAddress.toLowerCase();
    const existingOrder = bounty.reviewPaymentOrder;
    const reusableOrder = existingOrder
      && bounty.reviewPaymentOrderId === existingOrder.orderId
      && bounty.reviewPaymentTargetPlan === targetPlan
      && bounty.reviewPaymentPayerAddress?.toLowerCase() === payer
      && existingOrder.amountWei === amountWei
      && existingOrder.expiresAt * 1_000 > Date.now()
      && !['FAILED', 'EXPIRED', 'CANCELLED'].includes(bounty.reviewPaymentOrderStatus ?? 'CHECKOUT_VERIFIED');
    if (reusableOrder) {
      const status = await this.reviewPaymentGateway.getOrderStatus(existingOrder.orderId);
      assertConfirmedReviewOrder(status, bounty);
      if (!['FAILED', 'EXPIRED', 'CANCELLED'].includes(status.status)) {
        const clientTxHash = status.txHash ?? bounty.reviewPaymentPendingTxHash;
        const refreshed: Bounty = { ...bounty, reviewPaymentOrderStatus: status.status };
        if (clientTxHash) refreshed.reviewPaymentPendingTxHash = clientTxHash;
        await this.repository.save(refreshed);
        return { ...existingOrder, ...(clientTxHash ? { clientTxHash } : {}) };
      }
    }

    const intentId = randomUUID();
    const pending: Bounty = {
      ...bounty,
      reviewPaymentIntentId: intentId,
      reviewPaymentTargetPlan: targetPlan,
      reviewPaymentPayerAddress: payer,
      reviewPaymentOrderStatus: 'CHECKOUT_VERIFIED'
    };
    delete pending.reviewPaymentOrderId;
    delete pending.reviewPaymentOrder;
    delete pending.reviewPaymentProof;
    delete pending.reviewPaymentPendingTxHash;
    await this.repository.save(pending);

    const order = await this.reviewPaymentGateway.createOrder({
      dappOrderId: intentId,
      payer: bounty.ownerAddress as `0x${string}`,
      amountWei
    });
    assertCreatedReviewOrder(order, bounty.ownerAddress, amountWei, this.reviewConfig.paymentToken);
    const updated: Bounty = {
      ...pending,
      reviewPaymentOrderId: order.orderId,
      reviewPaymentOrderIds: uniqueValues([...bounty.reviewPaymentOrderIds, order.orderId]),
      reviewPaymentOrder: order
    };
    await this.repository.save(updated);
    return order;
  }

  async confirmReviewPayment(id: string, orderId: string, txHash: `0x${string}`, actor: AuthUser) {
    const bounty = await this.get(id);
    this.assertOwner(bounty, actor.id);
    if (bounty.reviewPaymentOrderId !== orderId || !bounty.reviewPaymentOrder || !bounty.reviewPaymentIntentId || !bounty.reviewPaymentTargetPlan) {
      throw new DomainError('This GOAT Flow order is not the active review payment', 409, 'PAYMENT_ORDER_MISMATCH');
    }
    if (bounty.reviewPaymentTxHashes.some((hash) => hash.toLowerCase() === txHash.toLowerCase())) return bounty;
    if (!this.reviewConfig.paymentToken || !this.reviewPaymentGateway.configured) {
      throw new DomainError('Review payments are not configured yet', 503, 'REVIEW_PAYMENTS_NOT_CONFIGURED');
    }
    const targetPlan = bounty.reviewPaymentTargetPlan;
    const payment = calculateReviewUpgrade(bounty, targetPlan, this.reviewConfig);
    const expectedAmount = parseUnits(payment.amount, this.reviewConfig.tokenDecimals);
    if (bounty.reviewPaymentOrder.amountWei !== expectedAmount.toString()) {
      throw new DomainError('The review price changed after this order was created', 409, 'PAYMENT_AMOUNT_CHANGED');
    }
    const reused = await this.repository.findReviewPaymentConflict(txHash, orderId, bounty.id);
    if (reused) throw new DomainError('This transaction has already purchased a review', 409, 'PAYMENT_ALREADY_USED');
    await this.reviewPayments.verify({
      txHash,
      payer: bounty.ownerAddress as `0x${string}`,
      token: bounty.reviewPaymentOrder.tokenContract as `0x${string}`,
      payTo: bounty.reviewPaymentOrder.payToAddress as `0x${string}`,
      amount: expectedAmount
    });
    if (bounty.reviewPaymentPendingTxHash?.toLowerCase() !== txHash.toLowerCase()) {
      await this.repository.save({ ...bounty, reviewPaymentPendingTxHash: txHash });
    }

    const status = await this.reviewPaymentGateway.waitForConfirmation(orderId);
    assertConfirmedReviewOrder(status, bounty, txHash);
    if (!['PAYMENT_CONFIRMED', 'INVOICED'].includes(status.status)) {
      await this.repository.save({ ...bounty, reviewPaymentPendingTxHash: txHash, reviewPaymentOrderStatus: status.status });
      throw new DomainError(`GOAT Flow payment ended with status ${status.status}`, 409, 'PAYMENT_NOT_CONFIRMED');
    }
    const proof = await this.reviewPaymentGateway.getOrderProof(orderId);
    assertReviewPaymentProof(proof, bounty, txHash, expectedAmount.toString());
    const updated: Bounty = {
      ...bounty,
      reviewPlan: targetPlan,
      reviewPrice: payment.targetPrice,
      reviewPaidAmount: payment.targetPrice,
      reviewPaymentStatus: 'PAID',
      reviewPaymentTxHash: txHash,
      reviewPaymentTxHashes: [...bounty.reviewPaymentTxHashes, txHash],
      reviewPaymentOrderStatus: status.status,
      reviewPaymentProof: proof as unknown as Record<string, unknown>,
      reviewPaidAt: new Date().toISOString()
    };
    delete updated.reviewPaymentPendingTxHash;
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
    const pendingCount = await this.applications.countPendingByDeveloper(actor.id);
    if (pendingCount >= MAX_PENDING_APPLICATIONS) throw new DomainError('You have reached the maximum of 5 pending applications. Withdraw a pending application to free a slot.', 409, 'MAX_PENDING_APPLICATIONS_REACHED');
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

  async withdrawApplication(applicationId: string, actor: AuthUser) {
    const application = await this.applications.get(applicationId);
    if (!application || application.developerUserId !== actor.id) throw new DomainError('Application not found', 404, 'APPLICATION_NOT_FOUND');
    if (application.status !== 'PENDING') throw new DomainError('Only pending applications can be withdrawn', 409, 'APPLICATION_NOT_PENDING');
    await this.applications.withdraw(applicationId);
    return { ...application, status: 'WITHDRAWN' as const, updatedAt: new Date().toISOString() };
  }

  async getApplicationSlots(actor: AuthUser) {
    const pending = await this.applications.countPendingByDeveloper(actor.id);
    const remaining = Math.max(0, MAX_PENDING_APPLICATIONS - pending);
    // Keep active/max during the rolling deployment so the previous frontend
    // remains compatible until the new pending-specific labels are live.
    return { pending, maxPending: MAX_PENDING_APPLICATIONS, remaining, active: pending, max: MAX_PENDING_APPLICATIONS };
  }

  async getSubmissionReportEvidence(id: string, actor: AuthUser) {
    const bounty = await this.get(id);
    this.assertOwner(bounty, actor.id);
    if (!bounty.submission) throw new DomainError('Bounty has no submitted pull request', 409, 'SUBMISSION_REQUIRED');
    if (bounty.submission.changedFiles !== undefined) {
      return {
        author: bounty.submission.author,
        changedFiles: bounty.submission.changedFiles,
        additions: bounty.submission.additions ?? 0,
        deletions: bounty.submission.deletions ?? 0
      };
    }
    const evidence = await this.github.getPullRequest(bounty.submission.pullRequestUrl);
    if (evidence.headSha !== bounty.submission.commitSha) {
      throw new DomainError('The pull request changed after this report was created', 409, 'COMMIT_MISMATCH');
    }
    return {
      author: evidence.author,
      changedFiles: evidence.changedFiles,
      additions: evidence.additions,
      deletions: evidence.deletions
    };
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

  async markFunded(id: string, onchainId: string, fundingTxHash: string, actorUserId: string) {
    const bounty = await this.get(id);
    // Legacy rows without an owner must never bypass authorization. They need
    // an explicit data repair before a user can record an on-chain funding.
    if (bounty.ownerUserId !== actorUserId) {
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
    if (Date.now() > new Date(bounty.contributorDeadline).getTime()) {
      throw new DomainError('The contributor submission deadline has passed', 409, 'CONTRIBUTOR_DEADLINE_PASSED');
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
    if (!actor.isDemoUser) {
      // Fail closed: an unverified identity must not skip the authorship check.
      if (!actor.identityVerified || !actor.githubId) {
        throw new DomainError('A verified GitHub identity is required to submit work', 403, 'GITHUB_IDENTITY_REQUIRED');
      }
      if (actor.githubId !== evidence.authorId) {
        throw new DomainError('The signed-in GitHub user must own the pull request', 403, 'PR_OWNER_MISMATCH');
      }
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
        author: evidence.author,
        changedFiles: evidence.changedFiles,
        additions: evidence.additions,
        deletions: evidence.deletions,
        ...(input.submissionTxHash ? { submissionTxHash: input.submissionTxHash } : {}),
        submittedAt: new Date().toISOString()
      }
    };
    delete updated.decision;
    updated.timeoutResolution = 'NONE';
    delete updated.timeoutResolvedAt;
    delete updated.appealDeadline;
    delete updated.appealMessage;
    await this.repository.save(updated);
    return { bounty: updated, evidence };
  }

  async verify(id: string, input: VerificationInput) {
    const bounty = await this.get(id);
    if (!['SUBMITTED', 'VERIFYING'].includes(bounty.status) || !bounty.submission) {
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
    // The maintainer asked for this explicitly, so let them take over a claim
    // left behind by a review whose process died before it could release it.
    return this.runPaidReview(id, { reclaimInterruptedReview: true });
  }

  async runPaidReview(id: string, options: { reclaimInterruptedReview?: boolean } = {}) {
    const bounty = await this.get(id);
    const claimableFrom: Bounty['status'][] = options.reclaimInterruptedReview ? ['SUBMITTED', 'VERIFYING'] : ['SUBMITTED'];
    if (!claimableFrom.includes(bounty.status) || !bounty.submission) {
      throw new DomainError('Bounty has no submission ready for review', 409, 'SUBMISSION_REQUIRED');
    }
    if (bounty.reviewPlan === 'NONE') throw new DomainError('This bounty uses manual review', 409, 'MANUAL_REVIEW_SELECTED');
    // Claim the review before the billable model call. Without this, concurrent
    // requests each spend a full OpenAI review against the one purchased slot,
    // because verify() only marks the payment CONSUMED once the call returns.
    const claimed = await this.repository.saveIfStatus({ ...bounty, status: 'VERIFYING' }, bounty.status);
    if (!claimed) throw new DomainError('An Owl Agent review is already running for this submission', 409, 'REVIEW_ALREADY_RUNNING');
    try {
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
      return await this.verify(id, input);
    } catch (error) {
      // Release the claim so a failed review can be retried.
      const current = await this.repository.get(id);
      if (current?.status === 'VERIFYING') await this.repository.saveIfStatus({ ...current, status: 'SUBMITTED' }, 'VERIFYING');
      throw error;
    }
  }

  async approve(id: string, actor: AuthUser) {
    const bounty = await this.get(id);
    this.assertOwner(bounty, actor.id);
    if (Date.now() > new Date(bounty.maintainerReviewDeadline).getTime()) {
      throw new DomainError('The maintainer review period has ended; Owl AI resolution is now required', 409, 'MAINTAINER_REVIEW_EXPIRED');
    }
    // VERIFYING counts as submitted: an agent review that was interrupted must
    // never lock the maintainer out of their own bounty.
    const awaitingReview = bounty.status === 'SUBMITTED' || bounty.status === 'VERIFYING';
    const manualReviewReady = bounty.reviewPlan === 'NONE' && awaitingReview && bounty.submission;
    const agentReviewReady = bounty.reviewPlan !== 'NONE' && bounty.status === 'READY_FOR_REVIEW' && bounty.decision;
    const revisionFollowupReady = awaitingReview && bounty.revisionRequests.length > 0 && bounty.submission;
    if (!manualReviewReady && !agentReviewReady && !revisionFollowupReady) throw new DomainError('This bounty is not ready for maintainer approval', 409, 'NOT_READY_FOR_REVIEW');
    const payoutTxHash = await this.settlement.approveAndRelease(
      requireOnchainId(bounty, this.settlement.writesEnabled),
      bounty.decision ? hashDecision(bounty.decision) : hashManualDecision(bounty, 'APPROVE'),
      bounty.escrowContractAddress
    );
    const updated: Bounty = payoutTxHash
      ? { ...bounty, status: 'PAID', payoutTxHash }
      : { ...bounty, status: 'APPROVED' };
    await this.repository.save(updated);
    return updated;
  }

  async requestRevision(id: string, actor: AuthUser, input: RequestRevisionInput) {
    const bounty = await this.get(id);
    this.assertOwner(bounty, actor.id);
    // VERIFYING counts as submitted: an agent review that was interrupted must
    // never lock the maintainer out of their own bounty.
    const awaitingReview = bounty.status === 'SUBMITTED' || bounty.status === 'VERIFYING';
    const manualReviewReady = bounty.reviewPlan === 'NONE' && awaitingReview && bounty.submission;
    const agentReviewReady = bounty.reviewPlan !== 'NONE' && bounty.status === 'READY_FOR_REVIEW' && bounty.decision;
    const revisionFollowupReady = awaitingReview && bounty.revisionRequests.length > 0 && bounty.submission;
    if (!manualReviewReady && !agentReviewReady && !revisionFollowupReady) throw new DomainError('This bounty is not ready for maintainer review', 409, 'NOT_READY_FOR_REVIEW');
    if (bounty.revisionRequests.length >= MAX_REVISIONS) {
      throw new DomainError('This bounty has reached its two-revision limit', 409, 'MAXIMUM_REVISIONS_REACHED');
    }
    const now = Date.now();
    const reviewDeadline = new Date(bounty.maintainerReviewDeadline).getTime();
    if (now + REVISION_RESPONSE_PERIOD_MS > reviewDeadline) {
      throw new DomainError('There is not enough time left in the fixed maintainer review window to request another revision', 409, 'REVISION_WINDOW_CLOSED');
    }
    const currentContributorDeadline = new Date(bounty.contributorDeadline).getTime();
    if (bounty.revisionExtensionUsed && now >= currentContributorDeadline) {
      throw new DomainError('The one-time contributor extension has ended', 409, 'CONTRIBUTOR_DEADLINE_PASSED');
    }
    const extensionGranted = !bounty.revisionExtensionUsed && currentContributorDeadline < now + REVISION_RESPONSE_PERIOD_MS;
    const contributorDeadline = extensionGranted
      ? new Date(now + REVISION_RESPONSE_PERIOD_MS).toISOString()
      : bounty.contributorDeadline;
    const revisionRequest: RevisionRequest = {
      id: randomUUID(),
      message: input.message,
      commitSha: bounty.submission!.commitSha,
      requestedAt: new Date().toISOString(),
      extensionGranted,
      contributorDeadline,
      ...(actor.githubLogin ? { requestedByGithubLogin: actor.githubLogin } : {})
    };
    await this.settlement.requestRevision(
      requireOnchainId(bounty, this.settlement.writesEnabled),
      hashRevisionRequest(bounty, revisionRequest),
      bounty.escrowContractAddress
    );
    const updated: Bounty = {
      ...bounty,
      status: 'REVISION_REQUIRED',
      revisionRequests: [...bounty.revisionRequests, revisionRequest],
      contributorDeadline,
      revisionExtensionUsed: bounty.revisionExtensionUsed || extensionGranted
    };
    await this.repository.save(updated);
    return updated;
  }

  async appealTimeoutResolution(id: string, actor: AuthUser, message: string) {
    const bounty = await this.get(id);
    if (bounty.assignedDeveloperUserId !== actor.id) throw new DomainError('Only the assigned developer can appeal', 403, 'FORBIDDEN');
    if (bounty.timeoutResolution !== 'AUTO_FAILED_PENDING' || !bounty.appealDeadline) {
      throw new DomainError('This bounty has no appealable Owl AI resolution', 409, 'APPEAL_NOT_AVAILABLE');
    }
    if (Date.now() > new Date(bounty.appealDeadline).getTime()) throw new DomainError('The appeal window has ended', 409, 'APPEAL_WINDOW_ENDED');
    const normalized = message.trim();
    if (normalized.length < 20 || normalized.length > 2000) throw new DomainError('Appeal details must be between 20 and 2000 characters');
    const updated: Bounty = { ...bounty, timeoutResolution: 'DISPUTED', appealMessage: normalized };
    await this.repository.save(updated);
    return updated;
  }

  async resolveDueBounties(now = Date.now()) {
    return this.resolutions.resolveDueBounties(now);
  }

  async markPaid(id: string, payoutTxHash: string) {
    const bounty = await this.get(id);
    if (bounty.status !== 'APPROVED') throw new DomainError('Only an approved bounty can be paid', 409, 'NOT_APPROVED');
    const updated: Bounty = { ...bounty, status: 'PAID', payoutTxHash };
    await this.repository.save(updated);
    return updated;
  }

  async markRefunded(id: string, refundTxHash: string, actor: AuthUser) {
    const bounty = await this.get(id);
    this.assertOwner(bounty, actor.id);
    if (!['OPEN', 'ASSIGNED', 'REVISION_REQUIRED', 'EXPIRED'].includes(bounty.status)
      || Date.now() <= new Date(bounty.contributorDeadline).getTime()) {
      throw new DomainError('This bounty is not eligible for an expired-delivery refund', 409, 'REFUND_NOT_AVAILABLE');
    }
    const updated: Bounty = { ...bounty, status: 'REFUNDED', refundTxHash };
    await this.repository.save(updated);
    return updated;
  }

  private assertOwner(bounty: Bounty, actorUserId: string) {
    if (!bounty.ownerUserId || bounty.ownerUserId !== actorUserId) throw new DomainError('Only the bounty owner can perform this action', 403, 'FORBIDDEN');
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

function hashRevisionRequest(bounty: Bounty, request: RevisionRequest): `0x${string}` {
  return `0x${createHash('sha256').update(JSON.stringify({
    action: 'REVISION_REQUIRED',
    bountyId: bounty.id,
    commitSha: request.commitSha,
    message: request.message,
    requestedAt: request.requestedAt,
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
  async requestRevision() { return null; },
  async approveAfterTimeout() { return null; },
  async refundAfterTimeout() { return null; }
};

const unavailableReviewPaymentGateway: ReviewPaymentGateway = {
  configured: false,
  async createOrder() { throw new DomainError('Review payments are not configured yet', 503, 'REVIEW_PAYMENTS_NOT_CONFIGURED'); },
  async getOrderStatus() { throw new DomainError('Review payments are not configured yet', 503, 'REVIEW_PAYMENTS_NOT_CONFIGURED'); },
  async waitForConfirmation() { throw new DomainError('Review payments are not configured yet', 503, 'REVIEW_PAYMENTS_NOT_CONFIGURED'); },
  async getOrderProof() { throw new DomainError('Review payments are not configured yet', 503, 'REVIEW_PAYMENTS_NOT_CONFIGURED'); }
};

export interface SettlementConfig {
  escrowContractAddress: `0x${string}` | '';
}

const defaultSettlementConfig: SettlementConfig = { escrowContractAddress: '' };

const unavailableReviewPaymentVerifier: ReviewPaymentVerifier = {
  async verify() { throw new DomainError('Review payments are not configured yet', 503, 'REVIEW_PAYMENTS_NOT_CONFIGURED'); }
};

function requirePaidReviewPlan(plan: ReviewPlan): Exclude<ReviewPlan, 'NONE'> {
  if (plan === 'STANDARD' || plan === 'SECURITY') return plan;
  throw new DomainError('Choose Standard or Security to purchase an Owl Agent review', 400, 'PAID_REVIEW_PLAN_REQUIRED');
}

function uniqueValues(values: string[]) {
  return [...new Set(values)];
}
