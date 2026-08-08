import 'dotenv/config';
import { z } from 'zod';

const optionalAddress = z.union([z.literal(''), z.string().regex(/^0x[a-fA-F0-9]{40}$/)]);
const optionalPrivateKey = z.union([z.literal(''), z.string().regex(/^0x[a-fA-F0-9]{64}$/)]);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('127.0.0.1'),
  FRONTEND_ORIGIN: z.string().default('http://localhost:3000'),
  PERSISTENCE_MODE: z.enum(['memory', 'supabase']).default('memory'),
  SUPABASE_URL: z.union([z.literal(''), z.string().url()]).default(''),
  SUPABASE_SECRET_KEY: z.string().default(''),
  AGENT_API_KEY: z.string().min(24).or(z.literal('')).default(''),
  GOAT_CHAIN_ID: z.coerce.number().int().default(48816),
  GOAT_RPC_URL: z.string().url().default('https://rpc.testnet3.goat.network'),
  GOAT_EXPLORER_URL: z.string().url().default('https://explorer.testnet3.goat.network'),
  OWL_PAY_CONTRACT_ADDRESS: optionalAddress.default(''),
  PAYMENT_TOKEN_ADDRESS: optionalAddress.default(''),
  PAYMENT_TOKEN_SYMBOL: z.string().min(1).default('USDC'),
  PAYMENT_TOKEN_DECIMALS: z.coerce.number().int().min(0).max(255).default(6),
  PLATFORM_TREASURY_ADDRESS: optionalAddress.default(''),
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(500).default(300),
  STANDARD_REVIEW_PRICE: z.string().regex(/^\d+(\.\d{1,6})?$/).default('1'),
  SECURITY_REVIEW_PRICE: z.string().regex(/^\d+(\.\d{1,6})?$/).default('2'),
  ENABLE_TESTNET_WRITES: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  SETTLEMENT_PRIVATE_KEY: optionalPrivateKey.default(''),
  GITHUB_TOKEN: z.string().default(''),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_MODEL: z.string().min(1).default('gpt-5-nano'),
  OPENAI_REVIEW_MAX_DIFF_CHARACTERS: z.coerce.number().int().min(1_000).max(250_000).default(60_000),
  CRON_SECRET: z.string().min(16).or(z.literal('')).default(''),
  ENABLE_RESOLUTION_WORKER: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  RESOLUTION_WORKER_INTERVAL_MS: z.coerce.number().int().min(10_000).max(3_600_000).default(60_000),
  GOAT_FLOW_API_URL: z.string().url().default('https://flow-api.testnet3.goat.network'),
  GOAT_FLOW_MERCHANT_ID: z.string().default(''),
  GOAT_FLOW_API_KEY: z.string().default(''),
  GOAT_FLOW_API_SECRET: z.string().default(''),
  GOAT_FLOW_TOKEN_SYMBOL: z.string().min(1).default('USDC'),
  GOAT_FLOW_TOKEN_ADDRESS: optionalAddress.default(''),
  GOAT_FLOW_TOKEN_DECIMALS: z.coerce.number().int().min(0).max(255).default(6)
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

if (parsed.data.ENABLE_TESTNET_WRITES && (!parsed.data.PAYMENT_TOKEN_ADDRESS || !parsed.data.PLATFORM_TREASURY_ADDRESS)) {
  throw new Error('Testnet writes require PAYMENT_TOKEN_ADDRESS and PLATFORM_TREASURY_ADDRESS.');
}

if (parsed.data.NODE_ENV === 'production' && (!parsed.data.GOAT_FLOW_API_KEY || !parsed.data.GOAT_FLOW_API_SECRET || !parsed.data.GOAT_FLOW_TOKEN_ADDRESS)) {
  throw new Error('Production requires GOAT Flow merchant API credentials.');
}

if (parsed.data.NODE_ENV === 'production' && !parsed.data.OPENAI_API_KEY) {
  throw new Error('Production requires an OpenAI API key for Owl Agent reviews.');
}

if (process.env.VERCEL === '1' && process.env.VERCEL_ENV === 'production' && !parsed.data.CRON_SECRET) {
  throw new Error('Production on Vercel requires CRON_SECRET for protected deadline resolution.');
}

export const env = parsed.data;
