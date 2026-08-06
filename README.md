# OwlPay MVP

"Hi world ,
It's OwlPay time!"
 ## OwlPay test submission
  Test pull request for the Owl Agent review flow.

OwlPay is a testnet-first GitHub bounty marketplace with evidence-based settlement.

- `frontend/`: responsive Next.js dashboard and wallet experience
- `backend/`: Fastify API, deterministic verification policy, GitHub evidence adapter, GOAT Testnet3 client and Solidity contracts

The MVP supports GitHub owner verification, applications and assignment, PR submission, GOAT Flow x402 merchant orders for one-time OpenAI-powered Owl Agent reviews, evidence-bound GitHub/CI/static analysis, maintainer approval, and GOAT Testnet3 escrow settlement. The contract sends 97% of the gross reward to the selected developer and 3% to the immutable OwlPay treasury.

The project defaults to safe demo mode. No private key is required locally. Real testnet writes are enabled only after deployment and explicit environment configuration.

## Quick start 

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

In a second terminal:

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. The API runs at `http://localhost:4000`.

See each application's README for Supabase migration, testnet deployment, and security notes.
