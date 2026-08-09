import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApplicationRepository } from '../application/ports.js';
import type { ApplicationStatus, BountyApplication } from '../domain/schemas.js';
import { DomainError } from '../domain/errors.js';

interface ApplicationRow {
  id: string;
  bounty_id: string;
  developer_user_id: string;
  developer_github_login: string;
  developer_github_avatar_url: string | null;
  developer_address: string;
  message: string;
  status: ApplicationStatus;
  created_at: string;
  updated_at: string;
}

export class SupabaseApplicationRepository implements ApplicationRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listByBounty(bountyId: string) {
    const { data, error } = await this.client.from('bounty_applications').select('*').eq('bounty_id', bountyId).order('created_at', { ascending: false });
    if (error) throw new DomainError(`Supabase application list failed: ${error.message}`, 500, 'DATABASE_ERROR');
    return (data as ApplicationRow[]).map(fromRow);
  }

  async listByDeveloper(developerUserId: string) {
    const { data, error } = await this.client.from('bounty_applications').select('*').eq('developer_user_id', developerUserId).order('created_at', { ascending: false });
    if (error) throw new DomainError(`Supabase developer application list failed: ${error.message}`, 500, 'DATABASE_ERROR');
    return (data as ApplicationRow[]).map(fromRow);
  }

  async get(id: string) {
    const { data, error } = await this.client.from('bounty_applications').select('*').eq('id', id).maybeSingle();
    if (error) throw new DomainError(`Supabase application get failed: ${error.message}`, 500, 'DATABASE_ERROR');
    return data ? fromRow(data as ApplicationRow) : undefined;
  }

  async findByBountyAndDeveloper(bountyId: string, developerUserId: string) {
    const { data, error } = await this.client.from('bounty_applications').select('*').eq('bounty_id', bountyId).eq('developer_user_id', developerUserId).maybeSingle();
    if (error) throw new DomainError(`Supabase application lookup failed: ${error.message}`, 500, 'DATABASE_ERROR');
    return data ? fromRow(data as ApplicationRow) : undefined;
  }

  async countByBounties(bountyIds: string[]) {
    if (bountyIds.length === 0) return {};
    const { data, error } = await this.client.from('bounty_applications').select('bounty_id,status').in('bounty_id', bountyIds).neq('status', 'WITHDRAWN');
    if (error) throw new DomainError(`Supabase application count failed: ${error.message}`, 500, 'DATABASE_ERROR');
    const result: Record<string, number> = Object.fromEntries(bountyIds.map((id) => [id, 0]));
    for (const row of data as Pick<ApplicationRow, 'bounty_id' | 'status'>[]) result[row.bounty_id] = (result[row.bounty_id] ?? 0) + 1;
    return result;
  }

  async save(application: BountyApplication) {
    const { error } = await this.client.from('bounty_applications').upsert(toRow(application), { onConflict: 'id' });
    if (error) throw new DomainError(`Supabase application save failed: ${error.message}`, 500, 'DATABASE_ERROR');
  }

  async resolveAssignment(bountyId: string, acceptedApplicationId: string) {
    const updatedAt = new Date().toISOString();
    const rejected = await this.client.from('bounty_applications').update({ status: 'REJECTED', updated_at: updatedAt }).eq('bounty_id', bountyId).neq('id', acceptedApplicationId);
    if (rejected.error) throw new DomainError(`Supabase application rejection failed: ${rejected.error.message}`, 500, 'DATABASE_ERROR');
    const accepted = await this.client.from('bounty_applications').update({ status: 'ACCEPTED', updated_at: updatedAt }).eq('id', acceptedApplicationId).eq('bounty_id', bountyId);
    if (accepted.error) throw new DomainError(`Supabase application acceptance failed: ${accepted.error.message}`, 500, 'DATABASE_ERROR');
  }

  async countPendingByDeveloper(developerUserId: string) {
    const { count, error } = await this.client.from('bounty_applications').select('*', { count: 'exact', head: true }).eq('developer_user_id', developerUserId).eq('status', 'PENDING');
    if (error) throw new DomainError(`Supabase pending application count failed: ${error.message}`, 500, 'DATABASE_ERROR');
    return count ?? 0;
  }

  async withdraw(applicationId: string) {
    const { error } = await this.client.from('bounty_applications').update({ status: 'WITHDRAWN', updated_at: new Date().toISOString() }).eq('id', applicationId);
    if (error) throw new DomainError(`Supabase application withdrawal failed: ${error.message}`, 500, 'DATABASE_ERROR');
  }
}

function fromRow(row: ApplicationRow): BountyApplication {
  return {
    id: row.id,
    bountyId: row.bounty_id,
    developerUserId: row.developer_user_id,
    developerGithubLogin: row.developer_github_login,
    developerGithubAvatarUrl: row.developer_github_avatar_url,
    developerAddress: row.developer_address,
    message: row.message,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

function toRow(application: BountyApplication): ApplicationRow {
  return {
    id: application.id,
    bounty_id: application.bountyId,
    developer_user_id: application.developerUserId,
    developer_github_login: application.developerGithubLogin,
    developer_github_avatar_url: application.developerGithubAvatarUrl,
    developer_address: application.developerAddress.toLowerCase(),
    message: application.message,
    status: application.status,
    created_at: application.createdAt,
    updated_at: application.updatedAt
  };
}
