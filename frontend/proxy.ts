import { NextResponse, type NextRequest } from 'next/server';

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

/**
 * Builds the per request policy. A fresh nonce is what lets script-src drop
 * 'unsafe-inline': Next.js reads the nonce back out of this header while
 * rendering and stamps it onto the scripts it emits, so its bootstrap still
 * runs while an injected inline script no longer does.
 *
 * Two deliberate limits:
 *
 * 'strict-dynamic' is left out. It would make browsers ignore 'self', so every
 * bundle would depend on Next.js never emitting a script without a nonce. The
 * same origin allowance is the safer default here, and the injection gap this
 * change exists to close is shut either way.
 *
 * style-src keeps 'unsafe-inline' because the UI sets style attributes directly
 * for avatar images and the payout animation. A nonce cannot cover a style
 * attribute, so removing it would blank those out.
 */
function contentSecurityPolicy(nonce: string) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${isDevelopment ? " 'unsafe-eval'" : ''}`,
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
}

export function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const policy = contentSecurityPolicy(nonce);

  // Next.js reads the policy from the *request* headers during rendering; the
  // response copy is what the browser enforces. Both have to carry the same
  // nonce or the scripts it stamps will not match what the browser allows.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Static assets are not documents and execute nothing, so they neither
      // need a policy nor a per request nonce.
      source: '/((?!_next/static|_next/image|favicon.ico|owlpay-logo.png|goat-network-symbol.svg).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' }
      ]
    }
  ]
};
