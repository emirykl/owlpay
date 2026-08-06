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
