# OwlPay backend

## Architecture

- `domain`: schemas, lifecycle types and domain errors
- `application`: use cases, ports and deterministic settlement policy
- `infrastructure`: GitHub, GOAT Testnet3 and persistence adapters
- `http`: Fastify transport
- `contracts`: single-token escrow, testnet token faucet and fee settlement

The in-memory repository is retained for isolated local tests. Shared and production deployments use Supabase Postgres through the same repository port.

## Supabase setup

1. Create a Supabase project.
2. Run the files under `supabase/migrations` in numeric order in the SQL editor. Existing projects that already ran the earlier migrations must also run `0005_optional_manual_reviews.sql` and `0006_review_plan_upgrades.sql`.
3. Enable GitHub under Authentication → Providers and copy the Supabase callback URL into the GitHub OAuth App.
4. Set `PERSISTENCE_MODE=supabase`, `SUPABASE_URL` and the backend-only `SUPABASE_SECRET_KEY`.
5. Generate a random `AGENT_API_KEY` with at least 24 characters.

The Supabase secret key must never be placed in `frontend/.env.local`. Browser writes to bounty, profile and wallet-challenge tables are revoked; financial mutations go through this API.

GitHub OAuth is also the authorization boundary for repository owners. OwlPay requests minimal public-profile access, forwards the short-lived provider token only to its own API, verifies that token against GitHub's immutable numeric user ID, and allows bounty creation only for public repositories where the user has push, maintain, or admin access. Provider tokens are not stored in Postgres.

## MVP lifecycle

1. A maintainer funds an open bounty.
2. Developers apply with a private note and their verified payout wallet.
3. The maintainer selects one application; the selected wallet is assigned on-chain.
4. The maintainer purchases one Standard or Security review package. This is a separate pay-per-use payment and never reduces the developer reward.
5. Only the assigned developer can submit a pull request. GitHub identity, repository, PR author and commit are verified before the submission hash is written on-chain.
6. If the review is already paid, the Owl Agent starts automatically after submission. It reads GitHub checks and diff patches, rejects failed checks and obvious secret/TLS/code-execution risks, and escalates uncertain evidence to a human.
7. The maintainer requests a revision or approves the report. Approval records the report hash and releases 97% to the developer and 3% to the immutable treasury.

The MVP deliberately does not execute untrusted repository code on the API server. It consumes GitHub CI results and performs a bounded patch scan. A production release should add an isolated, ephemeral CI worker and an independent smart-contract audit.

## Commands

```bash
npm run dev
npm run lint
npm run typecheck
npm test
npm run contract:compile
npm run contract:test
```

## Testnet deployment

1. Create a dedicated MetaMask account on chain `48816` and obtain native test BTC gas from `https://bridge.testnet3.goat.network/faucet`.
2. Copy `.env.example` to `.env`; set `DEPLOYER_PRIVATE_KEY`, `SETTLEMENT_AGENT_ADDRESS`, and `PLATFORM_TREASURY_ADDRESS` only in local/deployment secrets.
3. Leave `PAYMENT_TOKEN_ADDRESS` empty to deploy `OwlPayTestUSDC` automatically. It has 6 decimals, a once-per-day public test faucet, and no real-world value. If a reviewed supported token is later selected, set its address instead.
4. Run `npm run contract:deploy:testnet` and save both output addresses.
5. Set `OWL_PAY_CONTRACT_ADDRESS`, `PAYMENT_TOKEN_ADDRESS`, and `PLATFORM_TREASURY_ADDRESS` in the backend. Set the two public contract addresses in the frontend.
6. Run the contract tests, verify constructor values and roles on the explorer, then set `ENABLE_TESTNET_WRITES=true`.

Official GOAT Testnet3 deployments currently include tUSDC at `0xFCA5846c86dC8Df1B1e21447649A08a18B667B92` and tUSDT at `0x030B2C744Fa080D97c0033214dEF6384f763aB21`, both with 18 decimals. OwlPay defaults to its own 6-decimal test token because the public project documentation does not provide an ordinary-user faucet for those owner-minted assets.

## Review payment / x402 boundary

`POST /api/bounties/:id/review-payment` currently provides an x402-shaped MVP adapter: it returns HTTP 402 plus a machine-readable `PAYMENT-REQUIRED` header, then verifies the owner's exact onchain token transfer, receipt, sender, receiver, amount, and replay protection before issuing one review credit. It is not yet the complete hosted GOAT x402 merchant flow because it does not create a merchant order or persist the facilitator settlement proof. The domain boundary is intentionally isolated so the adapter can be replaced with the official DIRECT merchant integration without changing the bounty workflow.
