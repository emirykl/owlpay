import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/create-app.js';

const app = buildApp();

beforeAll(async () => app.ready());
afterAll(async () => app.close());

describe('HTTP API', () => {
  it('reports a healthy service in the configured write mode', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ status: 'ok', service: 'owlpay-api' });
    expect(['demo', 'testnet-write']).toContain(body.mode);
  });

  it('allows only the exactly configured browser origin', async () => {
    const allowed = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'http://localhost:3000' } });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');

    // Lookalikes must not be admitted. On shared hosts such as vercel.app any
    // name is registrable, so prefix and suffix variants are attacker-ownable.
    for (const origin of [
      'http://localhost:3000.evil.com',
      'https://localhost:3000',
      'http://evil-localhost:3000',
      'https://owlpay-evil.vercel.app'
    ]) {
      const rejected = await app.inject({ method: 'GET', url: '/health', headers: { origin } });
      expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('rejects unauthenticated deadline resolution requests', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/cron/resolve-due' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('creates and lists a validated bounty draft', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/bounties',
      payload: {
        title: 'Add a health endpoint',
        description: 'Return a stable service health response.',
        repositoryUrl: 'https://github.com/owlpay/demo',
        ownerAddress: '0x0000000000000000000000000000000000000001',
        rewardAmount: '20',
        reviewPlan: 'STANDARD',
        deadline: new Date(Date.now() + 86_400_000).toISOString(),
        criteria: [{ id: 'health', description: 'GET /health returns HTTP 200', mandatory: true, method: 'ci' }]
      }
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ status: 'DRAFT', title: 'Add a health endpoint' });
    const list = await app.inject({ method: 'GET', url: '/api/bounties' });
    expect(list.json().items).toHaveLength(1);
  });
});
