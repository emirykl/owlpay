import type { NextConfig } from 'next';

/**
 * The Content-Security-Policy is not here. It carries a per request nonce so
 * script-src can drop 'unsafe-inline', and a nonce cannot come from static
 * config, so `proxy.ts` issues it instead. Everything below is identical on
 * every response and stays where it can also cover the static asset paths the
 * proxy deliberately skips.
 */
const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
        ]
      }
    ];
  }
};

export default nextConfig;
