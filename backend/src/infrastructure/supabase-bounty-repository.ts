import type { SupabaseClient } from '@supabase/supabase-js';
import type { BountyRepository } from '../application/ports.js';
import type { AgentDecision, Bounty, BountyStatus, Criterion, Submission } from '../domain/schemas.js';

interface BountyRow {
  id: string;
  owner_user_id: string | null;
  owner_address: string;
  title: string;
  description: string;
  repository_url: string;
  reward_amount: string | number;
  verification_budget: string | number;
  deadline: string;
  criteria: Criterion[];
  status: BountyStatus;
  onchain_id: string | null;
  funding_tx_hash: string | null;
  payout_tx_hash: string | null;
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
    const { error } = await this.client.from('bounties').upsert(toRow(bounty), { onConflict: 'id' });
    if (error) throw new Error(`Supabase save failed: ${error.message}`);
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
    verificationBudget: String(row.verification_budget),
    deadline: new Date(row.deadline).toISOString(),
    criteria: row.criteria,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    applicantCount: 0
  };
  if (row.owner_user_id) bounty.ownerUserId = row.owner_user_id;
  if (row.onchain_id) bounty.onchainId = row.onchain_id;
  if (row.funding_tx_hash) bounty.fundingTxHash = row.funding_tx_hash;
  if (row.payout_tx_hash) bounty.payoutTxHash = row.payout_tx_hash;
  if (row.assigned_developer_user_id) bounty.assignedDeveloperUserId = row.assigned_developer_user_id;
  if (row.assigned_developer_github_login) bounty.assignedDeveloperGithubLogin = row.assigned_developer_github_login;
  if (row.assigned_developer_address) bounty.assignedDeveloperAddress = row.assigned_developer_address;
  if (row.assigned_at) bounty.assignedAt = new Date(row.assigned_at).toISOString();
  if (row.assignment_tx_hash) bounty.assignmentTxHash = row.assignment_tx_hash;
  if (row.submission) bounty.submission = row.submission;
  if (row.decision) bounty.decision = row.decision;
  return bounty;
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
    verification_budget: bounty.verificationBudget,
    deadline: bounty.deadline,
    criteria: bounty.criteria,
    status: bounty.status,
    onchain_id: bounty.onchainId ?? null,
    funding_tx_hash: bounty.fundingTxHash ?? null,
    payout_tx_hash: bounty.payoutTxHash ?? null,
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
