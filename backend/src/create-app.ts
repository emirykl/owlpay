import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { BountyService } from './application/bounty-service.js';
import { VerificationPolicy } from './application/verification-policy.js';
import { env } from './config/env.js';
import { DomainError } from './domain/errors.js';
import { GitHubClient } from './infrastructure/github-client.js';
import { InMemoryBountyRepository } from './infrastructure/in-memory-bounty-repository.js';
import { InMemoryApplicationRepository } from './infrastructure/in-memory-application-repository.js';
import { SupabaseBountyRepository } from './infrastructure/supabase-bounty-repository.js';
import { SupabaseApplicationRepository } from './infrastructure/supabase-application-repository.js';
import { GoatSettlementGateway } from './infrastructure/goat-settlement-gateway.js';
import { GoatReviewPaymentVerifier } from './infrastructure/goat-review-payment-verifier.js';
import { GoatFlowReviewPaymentGateway } from './infrastructure/goat-flow-review-payment-gateway.js';
import { OpenAIReviewAgent } from './infrastructure/openai-review-agent.js';
import { createSupabaseAdminClient, SupabaseAuthVerifier } from './infrastructure/supabase-client.js';
import { DemoAuthVerifier } from './application/auth.js';
import { DemoWalletIdentity } from './infrastructure/demo-wallet-identity.js';
import { SupabaseWalletIdentity } from './infrastructure/supabase-wallet-identity.js';
import { registerRoutes } from './http/routes.js';
import { runAfterResponse } from './infrastructure/background-task.js';

export function buildApp(createFastify: typeof Fastify = Fastify) {
  const app = createFastify({
    logger: env.NODE_ENV !== 'test',
    genReqId: () => crypto.randomUUID(),
    requestIdHeader: 'x-request-id'
  });
  const supabase = env.PERSISTENCE_MODE === 'supabase'
    ? createSupabaseAdminClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY)
    : null;
  const repository = supabase ? new SupabaseBountyRepository(supabase) : new InMemoryBountyRepository();
  const applications = supabase ? new SupabaseApplicationRepository(supabase) : new InMemoryApplicationRepository();
  const auth = supabase ? new SupabaseAuthVerifier(supabase) : new DemoAuthVerifier();
  const walletIdentity = supabase ? new SupabaseWalletIdentity(supabase) : new DemoWalletIdentity();
  const service = new BountyService(
    repository,
    applications,
    new GitHubClient(env.GITHUB_TOKEN, new OpenAIReviewAgent({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
      maxDiffCharacters: env.OPENAI_REVIEW_MAX_DIFF_CHARACTERS
    })),
    new VerificationPolicy(),
    new GoatSettlementGateway(),
    new GoatFlowReviewPaymentGateway({
      baseUrl: env.GOAT_FLOW_API_URL,
      apiKey: env.GOAT_FLOW_API_KEY,
      apiSecret: env.GOAT_FLOW_API_SECRET,
      chainId: env.GOAT_CHAIN_ID,
      tokenSymbol: env.GOAT_FLOW_TOKEN_SYMBOL,
      tokenContract: env.GOAT_FLOW_TOKEN_ADDRESS as `0x${string}` | ''
    }),
    new GoatReviewPaymentVerifier(),
    {
      paymentToken: env.GOAT_FLOW_TOKEN_ADDRESS as `0x${string}` | '',
      tokenDecimals: env.GOAT_FLOW_TOKEN_DECIMALS,
      standardPrice: env.STANDARD_REVIEW_PRICE,
      securityPrice: env.SECURITY_REVIEW_PRICE
    },
    {
      escrowContractAddress: env.OWL_PAY_CONTRACT_ADDRESS as `0x${string}` | ''
    }
  );

  app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  const allowedOrigins = env.FRONTEND_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
  app.register(cors, {
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, mobile)
      if (!origin) return callback(null, true);
      // Check exact match against configured origins
      if (allowedOrigins.includes(origin)) return callback(null, true);
      // Allow Vercel preview deployment URLs matching configured project prefixes
      if (allowedOrigins.some((allowed) => {
        try {
          const host = new URL(allowed).hostname;
          if (!host.endsWith('.vercel.app')) return false;
          const projectPrefix = host.replace('.vercel.app', '');
          const originHost = new URL(origin).hostname;
          return originHost.endsWith('.vercel.app') && originHost.includes(projectPrefix);
        } catch { /* ignore */ }
        return false;
      })) return callback(null, true);
      callback(new Error('CORS: origin not allowed'), false);
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Agent-Key', 'X-GitHub-Token'],
    exposedHeaders: ['PAYMENT-REQUIRED']
  });
  app.register(async (routesApp) => registerRoutes(routesApp, service, auth, walletIdentity, runAfterResponse));

  // Vercel functions are short-lived and may scale to multiple instances. The
  // protected cron route owns deadline resolution there; this interval remains
  // available for local development and persistent Node.js hosts.
  if (env.NODE_ENV !== 'test' && env.ENABLE_RESOLUTION_WORKER && process.env.VERCEL !== '1') {
    let resolutionRunning = false;
    const resolveDueBounties = async () => {
      if (resolutionRunning) return;
      resolutionRunning = true;
      try {
        await service.resolveDueBounties();
      } catch (error) {
        app.log.error(error, 'Bounty resolution worker failed');
      } finally {
        resolutionRunning = false;
      }
    };
    const resolutionTimer = setInterval(resolveDueBounties, env.RESOLUTION_WORKER_INTERVAL_MS);
    resolutionTimer.unref();
    app.addHook('onReady', resolveDueBounties);
    app.addHook('onClose', async () => clearInterval(resolutionTimer));
  }

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        ...(env.NODE_ENV !== 'production' ? { issues: error.issues } : {})
      });
    }
    if (error instanceof DomainError) {
      return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    }
    const normalized = error as Error & { statusCode?: number };
    const statusCode = typeof normalized.statusCode === 'number' ? normalized.statusCode : 500;
    return reply.code(statusCode).send({ code: 'INTERNAL_ERROR', message: statusCode === 500 ? 'Unexpected server error' : normalized.message });
  });

  return app;
}
