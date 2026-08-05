import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'OwlPay',
    short_name: 'OwlPay',
    description: 'Verified GitHub bounty settlement on GOAT Testnet3.',
    start_url: '/app',
    display: 'standalone',
    background_color: '#f5f5f2',
    theme_color: '#f5f5f2',
    icons: [{ src: '/owlpay-logo.png', sizes: '1254x1254', type: 'image/png', purpose: 'maskable' }]
  };
}
