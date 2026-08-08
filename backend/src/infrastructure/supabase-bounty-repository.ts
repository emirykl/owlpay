import type { SupabaseClient } from '@supabase/supabase-js';
import type { BountyRepository } from '../application/ports.js';
import type { AgentDecision, Bounty, BountyStatus, BrowserReviewPaymentOrder, Criterion, FlowOrderStatus, ReviewPaymentStatus, ReviewPlan, RevisionRequest, Submission, TimeoutResolution } from '../domain/schemas.js';

interface BountyRow {
  id: string;
  owner_user_id: string | null;
  owner_address: string;
  title: string;
  description: string;
  repository_url: string;
  reward_amount: string | number;
  verification_budget: string | number;
  review_plan: ReviewPlan;
  review_price: string | number;
  review_paid_amount: string | number | null;
  review_payment_status: ReviewPaymentStatus;
  review_payment_tx_hash: string | null;
  review_payment_tx_hashes: string[] | null;
  review_payment_intent_id: string | null;
  review_payment_order_id: string | null;
  review_payment_order_ids: string[] | null;
  review_payment_target_plan: Exclude<ReviewPlan, 'NONE'> | null;
  review_payment_payer_address: string | null;
  review_payment_order_status: FlowOrderStatus | null;
  review_payment_order: BrowserReviewPaymentOrder | null;
  review_payment_proof: Record<string, unknown> | null;
  review_payment_pending_tx_hash: string | null;
  review_paid_at: string | null;
  review_consumed_at: string | null;
  revision_requests: RevisionRequest[] | null;
  contributor_deadline: string | null;
  maintainer_review_deadline: string | null;
  revision_extension_used: boolean | null;
  timeout_resolution: TimeoutResolution | null;
  timeout_resolved_at: string | null;
  appeal_deadline: string | null;
  appeal_message: string | null;
  deadline: string;
  criteria: Criterion[];
  status: BountyStatus;
  onchain_id: string | null;
  escrow_contract_address: string | null;
  funding_tx_hash: string | null;
  payout_tx_hash: string | null;
  refund_tx_hash: string | null;
  assigned_developer_user_id: string | null;
  assigned_developer_github_login: string | null;
  assigned_developer_address: string | null;
  assigned_at: string | null;
  assignment_tx_hash: string | null;
  submission: Submission | null;
  decision: AgentDecision | null;
  created_at: string;
}

export class SupabaseBountyRepository implements BountyRepository {
  constructor(private readonly client: SupabaseClient) {}

  async list(): Promise<Bounty[]> {
    const { data, error } = await this.client.from('bounties').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(`Supabase list failed: ${error.message}`);
    return (data as BountyRow[]).map(fromRow);
  }

  async get(id: string): Promise<Bounty | undefined> {
    const { data, error } = await this.client.from('bounties').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`Supabase get failed: ${error.message}`);
    return data ? fromRow(data as BountyRow) : undefined;
  }

  async save(bounty: Bounty): Promise<void> {
    const row = toRow(bounty);
    const { error } = await this.client.from('bounties').upsert(row, { onConflict: 'id' });
    if (!error) return;
    // Keep deployments available while migration 0010 is being rolled out. Existing
    // funding transactions still resolve to their historical contract below.
    if (error.message.includes("'escrow_contract_address' column")) {
      const legacyRow: Partial<BountyRow> = { ...row };
      delete legacyRow.escrow_contract_address;
      const { error: legacyError } = await this.client.from('bounties').upsert(legacyRow, { onConflict: 'id' });
      if (!legacyError) return;
      throw new Error(`Supabase save failed: ${legacyError.message}`);
    }
    throw new Error(`Supabase save failed: ${error.message}`);
  }
}

function fromRow(row: BountyRow): Bounty {
  const bounty: Bounty = {
    id: row.id,
    ownerAddress: row.owner_address,
    title: row.title,
    description: row.description,
    repositoryUrl: row.repository_url,
    rewardAmount: String(row.reward_amount),
    reviewPlan: row.review_plan ?? 'STANDARD',
    reviewPrice: String(row.review_price ?? 2),
    reviewPaidAmount: String(row.review_paid_amount ?? (['PAID', 'CONSUMED'].includes(row.review_payment_status) ? row.review_price : 0)),
    reviewPaymentStatus: row.review_payment_status ?? 'REQUIRED',
    reviewPaymentTxHashes: row.review_payment_tx_hashes ?? (row.review_payment_tx_hash ? [row.review_payment_tx_hash] : []),
    reviewPaymentOrderIds: row.review_payment_order_ids ?? (row.review_payment_order_id ? [row.review_payment_order_id] : []),
    revisionRequests: row.revision_requests ?? [],
    contributorDeadline: new Date(row.contributor_deadline ?? row.deadline).toISOString(),
    maintainerReviewDeadline: new Date(row.maintainer_review_deadline ?? new Date(row.deadline).getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
    revisionExtensionUsed: row.revision_extension_used ?? false,
    timeoutResolution: row.timeout_resolution ?? 'NONE',
    deadline: new Date(row.deadline).toISOString(),
    criteria: row.criteria,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    applicantCount: 0
  };
  if (row.owner_user_id) bounty.ownerUserId = row.owner_user_id;
  if (row.onchain_id) bounty.onchainId = row.onchain_id;
  const escrowContractAddress = row.escrow_contract_address ?? legacyEscrowContract(row.funding_tx_hash);
  if (escrowContractAddress) bounty.escrowContractAddress = escrowContractAddress;
  if (row.funding_tx_hash) bounty.fundingTxHash = row.funding_tx_hash;
  if (row.payout_tx_hash) bounty.payoutTxHash = row.payout_tx_hash;
  if (row.refund_tx_hash) bounty.refundTxHash = row.refund_tx_hash;
  if (row.assigned_developer_user_id) bounty.assignedDeveloperUserId = row.assigned_developer_user_id;
  if (row.assigned_developer_github_login) bounty.assignedDeveloperGithubLogin = row.assigned_developer_github_login;
  if (row.assigned_developer_address) bounty.assignedDeveloperAddress = row.assigned_developer_address;
  if (row.assigned_at) bounty.assignedAt = new Date(row.assigned_at).toISOString();
  if (row.assignment_tx_hash) bounty.assignmentTxHash = row.assignment_tx_hash;
  if (row.submission) bounty.submission = row.submission;
  if (row.decision) bounty.decision = row.decision;
  if (row.review_payment_tx_hash) bounty.reviewPaymentTxHash = row.review_payment_tx_hash;
  if (row.review_payment_intent_id) bounty.reviewPaymentIntentId = row.review_payment_intent_id;
  if (row.review_payment_order_id) bounty.reviewPaymentOrderId = row.review_payment_order_id;
  if (row.review_payment_target_plan) bounty.reviewPaymentTargetPlan = row.review_payment_target_plan;
  if (row.review_payment_payer_address) bounty.reviewPaymentPayerAddress = row.review_payment_payer_address;
  if (row.review_payment_order_status) bounty.reviewPaymentOrderStatus = row.review_payment_order_status;
  if (row.review_payment_order) bounty.reviewPaymentOrder = row.review_payment_order;
  if (row.review_payment_proof) bounty.reviewPaymentProof = row.review_payment_proof;
  if (row.review_payment_pending_tx_hash) bounty.reviewPaymentPendingTxHash = row.review_payment_pending_tx_hash;
  if (row.review_paid_at) bounty.reviewPaidAt = new Date(row.review_paid_at).toISOString();
  if (row.review_consumed_at) bounty.reviewConsumedAt = new Date(row.review_consumed_at).toISOString();
  if (row.timeout_resolved_at) bounty.timeoutResolvedAt = new Date(row.timeout_resolved_at).toISOString();
  if (row.appeal_deadline) bounty.appealDeadline = new Date(row.appeal_deadline).toISOString();
  if (row.appeal_message) bounty.appealMessage = row.appeal_message;
  return bounty;
}

const LEGACY_ESCROW_BY_FUNDING_TX = new Map([
  ['0x474d4b554f3bed32159d078d2ba3f0a49811348acd5d4118332476cc992b2561', '0x9682ba996dd174ad87573a9cc0fb6bf228f72f24'],
  ['0xee91a885df7ff23525d7d540f29cb3b4249a9094df4c57c2c3bb3c0ba37c1d37', '0x9682ba996dd174ad87573a9cc0fb6bf228f72f24'],
  ['0xd4d00f0d630b20f5ac44fc50601f0f714a2fec276e7e46ec4d75f5195614cf19', '0x9682ba996dd174ad87573a9cc0fb6bf228f72f24'],
  ['0xf806d6483d34fce8cf63ab81d4760d2cdd7676c14b30ede37d5c12d36b8289fe', '0x1c45b6064d938545e4f22ae41cba42c7884c575f']
]);

function legacyEscrowContract(fundingTxHash: string | null) {
  return fundingTxHash ? LEGACY_ESCROW_BY_FUNDING_TX.get(fundingTxHash.toLowerCase()) : undefined;
}

function toRow(bounty: Bounty) {
  return {
    id: bounty.id,
    owner_user_id: bounty.ownerUserId ?? null,
    owner_address: bounty.ownerAddress.toLowerCase(),
    title: bounty.title,
    description: bounty.description,
    repository_url: bounty.repositoryUrl,
    reward_amount: bounty.rewardAmount,
    verification_budget: 0,
    review_plan: bounty.reviewPlan,
    review_price: bounty.reviewPrice,
    review_paid_amount: bounty.reviewPaidAmount,
    review_payment_status: bounty.reviewPaymentStatus,
    review_payment_tx_hash: bounty.reviewPaymentTxHash ?? null,
    review_payment_tx_hashes: bounty.reviewPaymentTxHashes,
    review_payment_intent_id: bounty.reviewPaymentIntentId ?? null,
    review_payment_order_id: bounty.reviewPaymentOrderId ?? null,
    review_payment_order_ids: bounty.reviewPaymentOrderIds,
    review_payment_target_plan: bounty.reviewPaymentTargetPlan ?? null,
    review_payment_payer_address: bounty.reviewPaymentPayerAddress?.toLowerCase() ?? null,
    review_payment_order_status: bounty.reviewPaymentOrderStatus ?? null,
    review_payment_order: bounty.reviewPaymentOrder ?? null,
    review_payment_proof: bounty.reviewPaymentProof ?? null,
    review_payment_pending_tx_hash: bounty.reviewPaymentPendingTxHash ?? null,
    review_paid_at: bounty.reviewPaidAt ?? null,
    review_consumed_at: bounty.reviewConsumedAt ?? null,
    revision_requests: bounty.revisionRequests,
    contributor_deadline: bounty.contributorDeadline,
    maintainer_review_deadline: bounty.maintainerReviewDeadline,
    revision_extension_used: bounty.revisionExtensionUsed,
    timeout_resolution: bounty.timeoutResolution,
    timeout_resolved_at: bounty.timeoutResolvedAt ?? null,
    appeal_deadline: bounty.appealDeadline ?? null,
    appeal_message: bounty.appealMessage ?? null,
    deadline: bounty.deadline,
    criteria: bounty.criteria,
    status: bounty.status,
    onchain_id: bounty.onchainId ?? null,
    escrow_contract_address: bounty.escrowContractAddress?.toLowerCase() ?? null,
    funding_tx_hash: bounty.fundingTxHash ?? null,
    payout_tx_hash: bounty.payoutTxHash ?? null,
    refund_tx_hash: bounty.refundTxHash ?? null,
    assigned_developer_user_id: bounty.assignedDeveloperUserId ?? null,
    assigned_developer_github_login: bounty.assignedDeveloperGithubLogin ?? null,
    assigned_developer_address: bounty.assignedDeveloperAddress?.toLowerCase() ?? null,
    assigned_at: bounty.assignedAt ?? null,
    assignment_tx_hash: bounty.assignmentTxHash ?? null,
    submission: bounty.submission ?? null,
    decision: bounty.decision ?? null,
    created_at: bounty.createdAt,
    updated_at: new Date().toISOString()
  };
}
