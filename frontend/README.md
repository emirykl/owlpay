# OwlPay frontend

A mobile-first Next.js interface for the testnet MVP.

## Design rules

- native system typography, generous whitespace and restrained glass surfaces
- minimum 40px interactive targets and visible focus states
- layouts for mobile, tablet and desktop
- reduced-motion support and semantic controls
- no wallet private keys or merchant credentials in browser code

## Run

```bash
npm install
cp .env.example .env.local
npm run dev
```

The connected wallet is forced onto GOAT Testnet3 (chain ID `48816`). A contract address is optional during local demo mode and required before enabling real testnet writes.

With deployed addresses configured, the creation wizard can claim faucet-only `otUSDC`, approve and lock the gross bounty reward, and display the 3% settlement fee before funding. The bounty owner later buys a one-time Owl Agent review from the bounty detail. That review payment is separate from escrow; the assigned developer never pays it.

For GitHub sign-in, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The publishable key is intentionally browser-visible and relies on the RLS policies in the backend migration. Never place a Supabase secret/service-role key in this application.

In Supabase mode, the bounty form lists only active public repositories where the signed-in GitHub user has push, maintain, or admin access. If an existing session predates this permission flow, sign out and connect GitHub again to refresh the provider authorization.
