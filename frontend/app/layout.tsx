import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'OwlPay',
  applicationName: 'OwlPay',
  description: 'AI-verified GitHub bounties with x402 review payments and onchain rewards on GOAT Network.',
  icons: {
    icon: [{ url: '/owlpay-logo.png', type: 'image/png' }],
    shortcut: '/owlpay-logo.png',
    apple: '/owlpay-logo.png'
  }
};

/**
 * The nonce in the policy `proxy.ts` sets only exists per request. A page
 * rendered at build time would ship script tags stamped with no nonce, and the
 * browser would then refuse to run them, so every route renders on request.
 */
export const dynamic = 'force-dynamic';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f5f5f2'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
