import type { FastifyInstance } from 'fastify';
import type { BountyService } from '../application/bounty-service.js';
import type { AuthVerifier } from '../application/auth.js';
import type { WalletIdentity } from '../application/wallet-identity.js';
import { addressSchema } from '../domain/schemas.js';
import { env } from '../config/env.js';
import { createBountySchema, submitWorkSchema, verificationInputSchema } from '../domain/schemas.js';
import { getNetworkStatus } from '../infrastructure/goat-client.js';

export async function registerRoutes(app: FastifyInstance, service: BountyService, auth: AuthVerifier, walletIdentity: WalletIdentity) {
  app.get('/health', async () => ({
    status: 'ok',
    service: 'owlpay-api',
    mode: env.ENABLE_TESTNET_WRITES ? 'testnet-write' : 'demo',
    persistence: env.PERSISTENCE_MODE
  }));

  app.get('/api/network', async () => ({
    chainId: env.GOAT_CHAIN_ID,
    name: 'GOAT Testnet3',
    rpcUrl: env.GOAT_RPC_URL,
    explorerUrl: env.GOAT_EXPLORER_URL,
    contractAddress: env.OWL_PAY_CONTRACT_ADDRESS || null,
    writesEnabled: env.ENABLE_TESTNET_WRITES,
    status: await getNetworkStatus()
  }));

  app.get('/api/me', async (request) => {
    const actor = await auth.requireUser(request.headers.authorization);
    return { user: actor, wallet: await walletIdentity.getStatus(actor) };
  });

  app.post('/api/wallet/challenge', async (request) => {
    const actor = await auth.requireUser(request.headers.authorization);
    const body = request.body as { address?: string };
    const address = addressSchema.parse(body.address);
    return walletIdentity.createChallenge(actor, address);
  });

  app.post('/api/wallet/verify', async (request) => {
    const actor = await auth.requireUser(request.headers.authorization);
    const body = request.body as { challengeId?: string; signature?: string };
    if (!body.challengeId || !body.signature || !/^0x[a-fA-F0-9]{130}$/.test(body.signature)) {
      return replyValidation(request, 'challengeId and a valid signature are required');
    }
    return walletIdentity.verify(actor, body.challengeId, body.signature);
  });

  app.get('/api/bounties', async (request) => {
    const actor = await auth.optionalUser(request.headers.authorization);
    const items = await service.list();
    return { items: items.filter((bounty) => bounty.status !== 'DRAFT' || bounty.ownerUserId === actor?.id) };
  });
  app.get<{ Params: { id: string } }>('/api/bounties/:id', async (request) => {
    const actor = await auth.optionalUser(request.headers.authorization);
    const bounty = await service.get(request.params.id);
    if (bounty.status === 'DRAFT' && bounty.ownerUserId !== actor?.id) {
      const error = new Error('Bounty not found') as Error & { statusCode: number };
      error.statusCode = 404;
      throw error;
    }
    return bounty;
  });

  app.post('/api/bounties', async (request, reply) => {
    const actor = await auth.requireUser(request.headers.authorization);
    const input = createBountySchema.parse(request.body);
    await walletIdentity.assertLinked(actor, input.ownerAddress);
    const bounty = await service.create(input, actor.id);
    return reply.code(201).send(bounty);
  });

  app.post<{ Params: { id: string } }>('/api/bounties/:id/funded', async (request) => {
    const actor = await auth.requireUser(request.headers.authorization);
    const body = request.body as { onchainId?: string; fundingTxHash?: string };
    if (!body.onchainId || !/^0x[a-fA-F0-9]{64}$/.test(body.fundingTxHash ?? '')) {
      return replyValidation(request, 'onchainId and a valid fundingTxHash are required');
    }
    return service.markFunded(request.params.id, body.onchainId, body.fundingTxHash!, actor.id);
  });

  app.post<{ Params: { id: string } }>('/api/bounties/:id/submissions', async (request, reply) => {
    const actor = await auth.requireUser(request.headers.authorization);
    const input = submitWorkSchema.parse(request.body);
    await walletIdentity.assertLinked(actor, input.developerAddress);
    const result = await service.submit(request.params.id, input, actor);
    return reply.code(201).send(result);
  });

  app.post<{ Params: { id: string } }>('/api/bounties/:id/verification', async (request) => {
    if (env.AGENT_API_KEY && request.headers['x-agent-key'] !== env.AGENT_API_KEY) {
      const error = new Error('Agent authorization is required') as Error & { statusCode: number };
      error.statusCode = 401;
      throw error;
    }
    const input = verificationInputSchema.parse(request.body);
    return service.verify(request.params.id, input);
  });
}

function replyValidation(_request: unknown, message: string): never {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = 400;
  throw error;
}
