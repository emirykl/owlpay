import 'dotenv/config';
import { z } from 'zod';

const optionalAddress = z.union([z.literal(''), z.string().regex(/^0x[a-fA-F0-9]{40}$/)]);
const optionalPrivateKey = z.union([z.literal(''), z.string().regex(/^0x[a-fA-F0-9]{64}$/)]);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('127.0.0.1'),
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:3000'),
  PERSISTENCE_MODE: z.enum(['memory', 'supabase']).default('memory'),
  SUPABASE_URL: z.union([z.literal(''), z.string().url()]).default(''),
  SUPABASE_SECRET_KEY: z.string().default(''),
  AGENT_API_KEY: z.string().min(24).or(z.literal('')).default(''),
  GOAT_CHAIN_ID: z.coerce.number().int().default(48816),
  GOAT_RPC_URL: z.string().url().default('https://rpc.testnet3.goat.network'),
  GOAT_EXPLORER_URL: z.string().url().default('https://explorer.testnet3.goat.network'),
  OWL_PAY_CONTRACT_ADDRESS: optionalAddress.default(''),
  PAYMENT_TOKEN_ADDRESS: optionalAddress.default(''),
  ENABLE_TESTNET_WRITES: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  SETTLEMENT_PRIVATE_KEY: optionalPrivateKey.default(''),
  GITHUB_TOKEN: z.string().default(''),
  GOAT_FLOW_API_URL: z.string().url().default('https://flow-api.testnet3.goat.network'),
  GOAT_FLOW_MERCHANT_ID: z.string().default(''),
  GOAT_FLOW_API_KEY: z.string().default('')
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
}

if (parsed.data.GOAT_CHAIN_ID !== 48816) {
  throw new Error('This MVP is locked to GOAT Testnet3 (chain ID 48816).');
}

if (parsed.data.PERSISTENCE_MODE === 'supabase' && (!parsed.data.SUPABASE_URL || !parsed.data.SUPABASE_SECRET_KEY)) {
  throw new Error('Supabase persistence requires SUPABASE_URL and SUPABASE_SECRET_KEY.');
}

if (parsed.data.NODE_ENV === 'production' && parsed.data.PERSISTENCE_MODE !== 'supabase') {
  throw new Error('Production requires PERSISTENCE_MODE=supabase; in-memory persistence is demo-only.');
}

if (parsed.data.NODE_ENV === 'production' && !parsed.data.AGENT_API_KEY) {
  throw new Error('Production requires a strong AGENT_API_KEY.');
}

if (parsed.data.ENABLE_TESTNET_WRITES && (!parsed.data.SETTLEMENT_PRIVATE_KEY || !parsed.data.OWL_PAY_CONTRACT_ADDRESS)) {
  throw new Error('Testnet writes require SETTLEMENT_PRIVATE_KEY and OWL_PAY_CONTRACT_ADDRESS.');
}

export const env = parsed.data;
