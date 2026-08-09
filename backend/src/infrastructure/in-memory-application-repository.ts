import type { ApplicationRepository } from '../application/ports.js';
import type { BountyApplication } from '../domain/schemas.js';

export class InMemoryApplicationRepository implements ApplicationRepository {
  private readonly applications = new Map<string, BountyApplication>();

  async listByBounty(bountyId: string) {
    return [...this.applications.values()].filter((item) => item.bountyId === bountyId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listByDeveloper(developerUserId: string) {
    return [...this.applications.values()].filter((item) => item.developerUserId === developerUserId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string) {
    const item = this.applications.get(id);
    return item ? structuredClone(item) : undefined;
  }

  async findByBountyAndDeveloper(bountyId: string, developerUserId: string) {
    const item = [...this.applications.values()].find((entry) => entry.bountyId === bountyId && entry.developerUserId === developerUserId);
    return item ? structuredClone(item) : undefined;
  }

  async countByBounties(bountyIds: string[]) {
    const result: Record<string, number> = Object.fromEntries(bountyIds.map((id) => [id, 0]));
    for (const application of this.applications.values()) {
      if (application.bountyId in result && application.status !== 'WITHDRAWN') result[application.bountyId] = (result[application.bountyId] ?? 0) + 1;
    }
    return result;
  }

  async save(application: BountyApplication) {
    this.applications.set(application.id, structuredClone(application));
  }

  async resolveAssignment(bountyId: string, acceptedApplicationId: string) {
    for (const [id, application] of this.applications) {
      if (application.bountyId !== bountyId) continue;
      this.applications.set(id, { ...application, status: id === acceptedApplicationId ? 'ACCEPTED' : 'REJECTED', updatedAt: new Date().toISOString() });
    }
  }

  async countPendingByDeveloper(developerUserId: string) {
    return [...this.applications.values()].filter(
      (item) => item.developerUserId === developerUserId && item.status === 'PENDING'
    ).length;
  }

  async withdraw(applicationId: string) {
    const application = this.applications.get(applicationId);
    if (application) {
      this.applications.set(applicationId, { ...application, status: 'WITHDRAWN', updatedAt: new Date().toISOString() });
    }
  }
}
