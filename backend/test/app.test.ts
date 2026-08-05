import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const app = buildApp();

beforeAll(async () => app.ready());
afterAll(async () => app.close());

describe('HTTP API', () => {
  it('reports a healthy demo-safe service', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'owlpay-api', mode: 'demo' });
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
