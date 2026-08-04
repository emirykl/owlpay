import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { BountyService } from './application/bounty-service.js';
import { VerificationPolicy } from './application/verification-policy.js';
import { env } from './config/env.js';
import { DomainError } from './domain/errors.js';
import { GitHubClient } from './infrastructure/github-client.js';
import { InMemoryBountyRepository } from './infrastructure/in-memory-bounty-repository.js';
import { SupabaseBountyRepository } from './infrastructure/supabase-bounty-repository.js';
import { createSupabaseAdminClient, SupabaseAuthVerifier } from './infrastructure/supabase-client.js';
import { DemoAuthVerifier } from './application/auth.js';
import { DemoWalletIdentity } from './infrastructure/demo-wallet-identity.js';
import { SupabaseWalletIdentity } from './infrastructure/supabase-wallet-identity.js';
import { registerRoutes } from './http/routes.js';

export function buildApp() {
  const app = Fastify({ logger: env.NODE_ENV !== 'test' });
  const supabase = env.PERSISTENCE_MODE === 'supabase'
    ? createSupabaseAdminClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY)
    : null;
  const repository = supabase ? new SupabaseBountyRepository(supabase) : new InMemoryBountyRepository();
  const auth = supabase ? new SupabaseAuthVerifier(supabase) : new DemoAuthVerifier();
  const walletIdentity = supabase ? new SupabaseWalletIdentity(supabase) : new DemoWalletIdentity();
  const service = new BountyService(
    repository,
    new GitHubClient(env.GITHUB_TOKEN),
    new VerificationPolicy()
  );

  app.register(cors, {
    origin: env.FRONTEND_ORIGIN,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Agent-Key']
  });
  app.register(async (routesApp) => registerRoutes(routesApp, service, auth, walletIdentity));

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Request validation failed', issues: error.issues });
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
