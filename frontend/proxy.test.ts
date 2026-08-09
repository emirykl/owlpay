import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { config, proxy } from './proxy';

function policyFor(path = 'https://owlpay.test/app') {
  const request = new NextRequest(new Request(path));
  const response = proxy(request);
  const policy = response.headers.get('content-security-policy') ?? '';
  const directives = Object.fromEntries(
    policy.split('; ').map((directive) => {
      const [name, ...values] = directive.split(' ');
      return [name, values.join(' ')];
    })
  );
  return { policy, directives };
}

describe('content security policy', () => {
  it('lets scripts run by nonce instead of by being inline', () => {
    const { directives } = policyFor();
    expect(directives['script-src']).toMatch(/^'self' 'nonce-[a-f0-9]+'/);
    expect(directives['script-src']).not.toContain("'unsafe-inline'");
  });

  it('issues a fresh nonce for every request', () => {
    const first = policyFor().policy.match(/'nonce-([a-f0-9]+)'/)?.[1];
    const second = policyFor().policy.match(/'nonce-([a-f0-9]+)'/)?.[1];
    expect(first).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it('keeps the rest of the policy intact', () => {
    const { directives } = policyFor();
    expect(directives['default-src']).toBe("'self'");
    expect(directives['frame-ancestors']).toBe("'none'");
    expect(directives['object-src']).toBe("'none'");
    expect(directives['base-uri']).toBe("'self'");
    expect(directives['form-action']).toBe("'self'");
    expect(directives['img-src']).toContain('https://avatars.githubusercontent.com');
  });

  // A style attribute cannot carry a nonce, and the UI sets several directly.
  it('still allows the inline style attributes the UI relies on', () => {
    expect(policyFor().directives['style-src']).toContain("'unsafe-inline'");
  });

  it('skips paths that serve no document', () => {
    const source = config.matcher[0]!.source;
    for (const path of ['/_next/static/chunk.js', '/_next/image', '/favicon.ico', '/owlpay-logo.png']) {
      expect(new RegExp(`^${source}$`).test(path)).toBe(false);
    }
    for (const path of ['/', '/app', '/auth/callback']) {
      expect(new RegExp(`^${source}$`).test(path)).toBe(true);
    }
  });
});
