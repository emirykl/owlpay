import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/create-app.js';

const app = buildApp();

beforeAll(async () => app.ready());
afterAll(async () => app.close());

describe('route input validation', () => {
  it('rejects wallet challenge with invalid address', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/wallet/challenge',
      payload: { address: 'not-an-address' }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects wallet challenge with missing address', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/wallet/challenge',
      payload: {}
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects wallet verify with invalid signature format', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/wallet/verify',
      payload: { challengeId: 'test-id', signature: 'bad-sig' }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects wallet verify with missing fields', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/wallet/verify',
      payload: {}
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects bounty funded with missing onchainId', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/bounties/test-id/funded',
      payload: { fundingTxHash: `0x${'a'.repeat(64)}` }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects bounty funded with invalid tx hash', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/bounties/test-id/funded',
      payload: { onchainId: '1', fundingTxHash: 'invalid' }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects bounty refunded with invalid tx hash', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/bounties/test-id/refunded',
      payload: { refundTxHash: 'not-a-hash' }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects review payment confirm with empty orderId', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/bounties/test-id/review-payment/confirm',
      payload: { orderId: '', txHash: `0x${'b'.repeat(64)}` }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects review payment confirm with missing txHash', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/bounties/test-id/review-payment/confirm',
      payload: { orderId: 'order-1' }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects bounty creation with invalid payload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/bounties',
      payload: { title: 'Hi' }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('response headers', () => {
  it('includes x-request-id in every response', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.headers['x-request-id']).toBeDefined();
    expect(typeof response.headers['x-request-id']).toBe('string');
    expect((response.headers['x-request-id'] as string).length).toBeGreaterThan(0);
  });

  it('returns the client-supplied x-request-id when provided', async () => {
    const clientId = 'client-trace-abc-123';
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': clientId }
    });
    expect(response.headers['x-request-id']).toBe(clientId);
  });
});

describe('error handler', () => {
  it('returns UNAUTHORIZED for agent verification without key', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/bounties/test-id/verification',
      payload: { confidence: 0.9, criterionResults: [], blockingIssues: [] },
      headers: { 'x-agent-key': 'wrong-key' }
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
