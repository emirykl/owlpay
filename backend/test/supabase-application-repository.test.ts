import { describe, expect, it } from 'vitest';
import type { BountyApplication } from '../src/domain/schemas.js';
import { SupabaseApplicationRepository } from '../src/infrastructure/supabase-application-repository.js';
import { createFakeSupabase } from './helpers/fake-supabase.js';

function application(overrides: Partial<BountyApplication> = {}): BountyApplication {
  return {
    id: 'application-1',
    bountyId: 'bounty-1',
    developerUserId: 'developer-1',
    developerGithubLogin: 'developer',
    developerGithubAvatarUrl: null,
    developerAddress: `0x${'A'.repeat(40)}`,
    message: 'I can implement this bounty with focused tests.',
    status: 'PENDING',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides
  };
}

function setup() {
  const supabase = createFakeSupabase({ bounty_applications: [] });
  return { supabase, repository: new SupabaseApplicationRepository(supabase.client) };
}

describe('supabase application repository', () => {
  it('saves, retrieves and normalizes a developer wallet', async () => {
    const { repository, supabase } = setup();
    await repository.save(application());

    expect(supabase.tables.bounty_applications![0]!.developer_address).toBe(`0x${'a'.repeat(40)}`);
    await expect(repository.get('application-1')).resolves.toMatchObject({
      id: 'application-1',
      developerAddress: `0x${'a'.repeat(40)}`
    });
    await expect(repository.get('missing')).resolves.toBeUndefined();
  });

  it('filters and orders bounty and developer application lists', async () => {
    const { repository } = setup();
    await repository.save(application({ id: 'older', createdAt: '2026-08-01T00:00:00.000Z' }));
    await repository.save(application({ id: 'newer', createdAt: '2026-08-02T00:00:00.000Z' }));
    await repository.save(application({ id: 'other', bountyId: 'bounty-2', developerUserId: 'developer-2' }));

    await expect(repository.listByBounty('bounty-1')).resolves.toMatchObject([{ id: 'newer' }, { id: 'older' }]);
    await expect(repository.listByDeveloper('developer-1')).resolves.toMatchObject([{ id: 'newer' }, { id: 'older' }]);
    await expect(repository.findByBountyAndDeveloper('bounty-2', 'developer-2')).resolves.toMatchObject({ id: 'other' });
  });

  it('counts non-withdrawn applications for each requested bounty', async () => {
    const { repository } = setup();
    await repository.save(application({ id: 'one' }));
    await repository.save(application({ id: 'withdrawn', status: 'WITHDRAWN' }));
    await repository.save(application({ id: 'two', bountyId: 'bounty-2' }));

    await expect(repository.countByBounties(['bounty-1', 'bounty-2', 'empty'])).resolves.toEqual({
      'bounty-1': 1,
      'bounty-2': 1,
      empty: 0
    });
    await expect(repository.countByBounties([])).resolves.toEqual({});
  });

  it('resolves one assignment and rejects the other candidates', async () => {
    const { repository } = setup();
    await repository.save(application({ id: 'accepted' }));
    await repository.save(application({ id: 'rejected', developerUserId: 'developer-2' }));
    await repository.save(application({ id: 'other-bounty', bountyId: 'bounty-2' }));

    await repository.resolveAssignment('bounty-1', 'accepted');

    await expect(repository.get('accepted')).resolves.toMatchObject({ status: 'ACCEPTED' });
    await expect(repository.get('rejected')).resolves.toMatchObject({ status: 'REJECTED' });
    await expect(repository.get('other-bounty')).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('counts only pending applications and supports withdrawal', async () => {
    const { repository } = setup();
    await repository.save(application({ id: 'pending' }));
    await repository.save(application({ id: 'accepted', bountyId: 'bounty-2', status: 'ACCEPTED' }));
    await repository.save(application({ id: 'rejected', bountyId: 'bounty-3', status: 'REJECTED' }));

    await expect(repository.countPendingByDeveloper('developer-1')).resolves.toBe(1);
    await repository.withdraw('pending');
    await expect(repository.get('pending')).resolves.toMatchObject({ status: 'WITHDRAWN' });
    await expect(repository.countPendingByDeveloper('developer-1')).resolves.toBe(0);
  });

  it('surfaces database failures as domain errors', async () => {
    const { repository, supabase } = setup();
    supabase.failNext({ message: 'connection unavailable' }, 'bounty_applications');

    await expect(repository.listByBounty('bounty-1')).rejects.toMatchObject({
      code: 'DATABASE_ERROR',
      statusCode: 500
    });
  });
});
