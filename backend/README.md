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
2. Run the files under `supabase/migrations` in numeric order in the SQL editor. Existing projects must apply every newer migration through `0009_bounty_resolution_windows.sql`.
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
6. If the review is already paid, the Owl Agent starts automatically after submission. It sends a bounded, commit-pinned GitHub evidence package to OpenAI, rejects failed checks and obvious secret/TLS/code-execution risks deterministically, and escalates uncertain evidence to a human.
7. The maintainer requests a revision or approves the report. Approval records the report hash and releases 97% to the developer and 3% to the immutable treasury.
8. Every bounty has one fixed maintainer deadline: seven days after the original contributor deadline. A revised pull request never resets that window.
9. A maintainer can request at most two revisions and cannot request one in the final 48 hours. If the contributor has less than 48 hours remaining, exactly one revision may extend the contributor deadline to 48 hours from the request.
10. Missed contributor delivery makes the escrow refundable. If the maintainer takes no action by the fixed review deadline, the resolution worker evaluates the commit-pinned evidence. A score of at least 60/100 pays only when all mandatory safeguards pass and no blocking issue exists; clear failures enter a short appeal window before refund, while inconclusive or appealed cases keep escrow locked for manual dispute handling.

The resolution worker runs only for due records and does not poll active pull requests. Configure it with `ENABLE_RESOLUTION_WORKER` and `RESOLUTION_WORKER_INTERVAL_MS`.

The MVP deliberately does not execute untrusted repository code on the API server. It consumes GitHub CI results and performs a bounded patch scan. A production release should add an isolated, ephemeral CI worker and an independent smart-contract audit.

## Owl Agent / OpenAI

Set `OPENAI_API_KEY` only in the backend environment. `OPENAI_MODEL` defaults to the low-cost `gpt-5-nano`, and `OPENAI_REVIEW_MAX_DIFF_CHARACTERS` caps the patch text sent per review.

Reviews use the OpenAI Responses API with strict structured output, low reasoning effort, `store: false`, and a hashed safety identifier. Pull-request text and patches are treated as untrusted evidence. Model-provided evidence references are checked against the exact commit, files, and GitHub checks supplied by OwlPay; unsupported passes become `UNKNOWN`. GitHub CI failures and the local Security-plan patch scan remain deterministic, and the existing verification policy makes the final approval/revision/human-review decision.

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
4. Run `npm run contract:deploy:testnet` and save both output addresses. Lifecycle-contract changes require a fresh testnet deployment before enabling the resolution worker.
5. Set `OWL_PAY_CONTRACT_ADDRESS`, `PAYMENT_TOKEN_ADDRESS`, and `PLATFORM_TREASURY_ADDRESS` in the backend. Set the two public contract addresses in the frontend.
6. Run the contract tests, verify constructor values and roles on the explorer, then set `ENABLE_TESTNET_WRITES=true`.

Official GOAT Testnet3 deployments currently include tUSDC at `0xFCA5846c86dC8Df1B1e21447649A08a18B667B92` and tUSDT at `0x030B2C744Fa080D97c0033214dEF6384f763aB21`, both with 18 decimals. OwlPay defaults to its own 6-decimal test token because the public project documentation does not provide an ordinary-user faucet for those owner-minted assets.

## Review payment / x402 boundary

`POST /api/bounties/:id/review-payment` creates an authenticated GOAT Flow DIRECT merchant order and returns HTTP 402 with the facilitator's machine-readable `PAYMENT-REQUIRED` payload. The browser pays that exact order through `goatflow-sdk` and confirms it with the returned order ID and transaction hash.

The backend grants a review credit only after all three checks agree: GOAT Flow reports `PAYMENT_CONFIRMED` or `INVOICED`, the persisted facilitator proof matches the original order, and the GOAT Testnet3 receipt contains the exact payer/token/receiver/amount transfer. Order IDs and transaction hashes are replay-protected and persisted through migration `0007_goat_flow_review_orders.sql`.

Merchant credentials (`GOAT_FLOW_API_KEY` and `GOAT_FLOW_API_SECRET`) stay in the backend environment. Set `GOAT_FLOW_TOKEN_SYMBOL`, `GOAT_FLOW_TOKEN_ADDRESS`, and `GOAT_FLOW_TOKEN_DECIMALS` to the token configured for the merchant. This review token is intentionally separate from `PAYMENT_TOKEN_ADDRESS`, which remains the bounty escrow token.
