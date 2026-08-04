# OwlPay MVP

OwlPay is a testnet-first GitHub bounty verification and settlement prototype.

- `frontend/`: responsive Next.js dashboard and wallet experience
- `backend/`: Fastify API, deterministic verification policy, GitHub evidence adapter, GOAT Testnet3 client and Solidity contracts

The first milestone intentionally defaults to demo mode. No private key is required to run the product locally. Real testnet writes are enabled only after contract deployment and explicit environment configuration.

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

See each application's README for testnet deployment and security notes.

