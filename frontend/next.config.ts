import type { NextConfig } from 'next';

const isDevelopment = process.env.NODE_ENV !== 'production';

/**
 * Endpoints the browser is allowed to reach. The session token and the GitHub
 * provider token both live in web storage, so restricting connect-src limits
 * where an injected script could send them.
 */
const connectSources = [
  "'self'",
  process.env.NEXT_PUBLIC_API_URL,
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_GOAT_RPC_URL,
  isDevelopment ? 'ws://localhost:*' : null
].filter(Boolean).join(' ');

// Next.js injects inline bootstrap and hydration scripts, so 'unsafe-inline' is
// required until a nonce-emitting middleware is added. The policy still blocks
// remote script origins, framing, plugins and form exfiltration.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  // Repository and contributor avatars are the only remote images.
  "img-src 'self' data: https://github.com https://avatars.githubusercontent.com",
  "font-src 'self' data:",
  `connect-src ${connectSources}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests'
].join('; ');

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
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

