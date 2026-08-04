# OwlPay backend

## Architecture

- `domain`: schemas, lifecycle types and domain errors
- `application`: use cases, ports and deterministic settlement policy
- `infrastructure`: GitHub, GOAT Testnet3 and persistence adapters
- `http`: Fastify transport
- `contracts`: escrow and audit-cap contract

The in-memory repository is retained for isolated local tests. Shared and production deployments use Supabase Postgres through the same repository port.

## Supabase setup

1. Create a Supabase project.
2. Run the files under `supabase/migrations` in numeric order in the SQL editor. Existing projects that already ran `0001_initial.sql` must also run `0002_github_identity.sql`.
3. Enable GitHub under Authentication → Providers and copy the Supabase callback URL into the GitHub OAuth App.
4. Set `PERSISTENCE_MODE=supabase`, `SUPABASE_URL` and the backend-only `SUPABASE_SECRET_KEY`.
5. Generate a random `AGENT_API_KEY` with at least 24 characters.

The Supabase secret key must never be placed in `frontend/.env.local`. Browser writes to bounty, profile and wallet-challenge tables are revoked; financial mutations go through this API.

GitHub OAuth is also the authorization boundary for repository owners. OwlPay requests minimal public-profile access, forwards the short-lived provider token only to its own API, verifies that token against GitHub's immutable numeric user ID, and allows bounty creation only for public repositories where the user has push, maintain, or admin access. Provider tokens are not stored in Postgres.

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

1. Obtain Testnet3 gas from `https://bridge.testnet3.goat.network/faucet`.
2. Copy `.env.example` to `.env`.
3. Set `DEPLOYER_PRIVATE_KEY` only in the local `.env` or deployment secret store.
4. Run `npm run contract:deploy:testnet`.
5. Put the resulting contract address in both backend and frontend environment files.
6. Keep `ENABLE_TESTNET_WRITES=false` until the deployed bytecode and roles are manually checked.

The verification budget is a strict audit cap. The testnet settlement wallet pays GOAT Flow/x402; the contract records the payment reference but cannot make arbitrary verifier transfers.
