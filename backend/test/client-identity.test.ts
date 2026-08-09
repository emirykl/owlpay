import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, resolveTrustProxy } from '../src/create-app.js';

const socketAddress = '203.0.113.10';
const forwardedClient = '198.51.100.7';

async function clientIpSeenBy(app: ReturnType<typeof buildApp>, headers: Record<string, string>) {
  app.get('/test/client-ip', async (request) => ({ ip: request.ip }));
  await app.ready();
  const response = await app.inject({
    method: 'GET',
    url: '/test/client-ip',
    remoteAddress: socketAddress,
    headers
  });
  return response.json().ip as string;
}

describe('client identity behind a proxy', () => {
  const apps: Array<ReturnType<typeof buildApp>> = [];
  const track = (app: ReturnType<typeof buildApp>) => {
    apps.push(app);
    return app;
  };

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    delete process.env.VERCEL;
  });

  it('trusts exactly one hop when the platform proxy sits in front', () => {
    expect(resolveTrustProxy(true)).toBe(1);
  });

  it('trusts nothing when the app is reachable directly', () => {
    expect(resolveTrustProxy(false)).toBe(false);
  });

  // Without a proxy in front, x-forwarded-for is caller controlled. Honouring it
  // would hand every client a fresh rate limit bucket per request.
  it('ignores a forwarded client that no proxy vouched for', async () => {
    const seen = await clientIpSeenBy(track(buildApp()), { 'x-forwarded-for': forwardedClient });
    expect(seen).toBe(socketAddress);
  });

  it('separates callers arriving through the platform proxy', async () => {
    process.env.VERCEL = '1';
    const app = track(buildApp());
    app.get('/test/client-ip', async (request) => ({ ip: request.ip }));
    await app.ready();

    const first = await app.inject({
      method: 'GET',
      url: '/test/client-ip',
      remoteAddress: socketAddress,
      headers: { 'x-forwarded-for': forwardedClient }
    });
    const second = await app.inject({
      method: 'GET',
      url: '/test/client-ip',
      remoteAddress: socketAddress,
      headers: { 'x-forwarded-for': '198.51.100.9' }
    });

    expect(first.json().ip).toBe(forwardedClient);
    expect(second.json().ip).toBe('198.51.100.9');
  });

  // A caller that prepends its own hop must not be able to hide behind it: with
  // one trusted hop the address the proxy observed is the one that counts.
  it('keeps the address the trusted proxy observed', async () => {
    process.env.VERCEL = '1';
    const seen = await clientIpSeenBy(track(buildApp()), {
      'x-forwarded-for': `192.0.2.50, ${forwardedClient}`
    });
    expect(seen).toBe(forwardedClient);
  });
});
