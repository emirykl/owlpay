import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { BountyService } from '../application/bounty-service.js';
import type { AuthVerifier } from '../application/auth.js';
import type { WalletIdentity } from '../application/wallet-identity.js';
import { appealResolutionSchema, bountyAssignSchema, bountyFundedSchema, bountyRefundedSchema, confirmReviewPaymentSchema, createApplicationSchema, createBountySchema, requestRevisionSchema, reviewPaymentRequestSchema, submitWorkSchema, verificationInputSchema, walletChallengeSchema, walletVerifySchema } from '../domain/schemas.js';
import { DomainError } from '../domain/errors.js';
import { env } from '../config/env.js';
import { getNetworkStatus } from '../infrastructure/goat-client.js';
import { bountyForViewer } from '../application/bounty-visibility.js';

type BackgroundTaskRunner = (task: Promise<unknown>) => void;

export async function registerRoutes(
  app: FastifyInstance,
  service: BountyService,
  auth: AuthVerifier,
  walletIdentity: WalletIdentity,
  runInBackground: BackgroundTaskRunner
) {
  app.get('/health', async () => ({
    status: 'ok',
    service: 'owlpay-api',
    mode: env.ENABLE_TESTNET_WRITES ? 'testnet-write' : 'demo',
    persistence: env.PERSISTENCE_MODE,
    uptime: Math.floor(process.uptime())
  }));

  app.get('/api/network', async () => ({
    chainId: env.GOAT_CHAIN_ID,
    name: 'GOAT Testnet3',
    rpcUrl: env.GOAT_RPC_URL,
    explorerUrl: env.GOAT_EXPLORER_URL,
    contractAddress: env.OWL_PAY_CONTRACT_ADDRESS || null,
    paymentTokenAddress: env.PAYMENT_TOKEN_ADDRESS || null,
    paymentToken: {
      address: env.PAYMENT_TOKEN_ADDRESS || null,
      symbol: env.PAYMENT_TOKEN_SYMBOL,
      decimals: env.PAYMENT_TOKEN_DECIMALS
    },
    reviewPaymentToken: {
      address: env.GOAT_FLOW_TOKEN_ADDRESS || null,
      symbol: env.GOAT_FLOW_TOKEN_SYMBOL,
      decimals: env.GOAT_FLOW_TOKEN_DECIMALS
    },
    platformFeeBps: env.PLATFORM_FEE_BPS,
    reviewPrices: { standard: env.STANDARD_REVIEW_PRICE, security: env.SECURITY_REVIEW_PRICE },
    writesEnabled: env.ENABLE_TESTNET_WRITES,
    status: await getNetworkStatus()
  }));

  app.get('/api/cron/resolve-due', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!env.CRON_SECRET || !secretMatches(request.headers.authorization, `Bearer ${env.CRON_SECRET}`)) {
      return reply.code(401).send({ code: 'UNAUTHORIZED', message: !env.CRON_SECRET ? 'CRON_SECRET is not configured' : 'Cron authorization is required' });
    }
    const items = await service.resolveDueBounties();
    return { ok: true, processed: items.length, items };
  });

  app.get('/api/me', async (request) => {
    const actor = await auth.requireUser(request.headers.authorization);
    return { user: actor, wallet: await walletIdentity.getStatus(actor) };
  });

  app.get('/api/github/repositories', async (request) => {
    const actor = await auth.requireUser(request.headers.authorization);
    return { items: await service.listManageableRepositories(actor, readGitHubToken(request.headers['x-github-token'])) };
  });

  app.post('/api/wallet/challenge', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => {
    const actor = await auth.requireUser(request.headers.authorization);
    const { address } = walletChallengeSchema.parse(request.body);
    return walletIdentity.createChallenge(actor, address);
  });

  app.post('/api/wallet/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => {
    const actor = await auth.requireUser(request.headers.authorization);
    const { challengeId, signature } = walletVerifySchema.parse(request.body);
    return walletIdentity.verify(actor, challengeId, signature);
  });

  app.get('/api/bounties', async (request) => {
    const actor = await auth.optionalUser(request.headers.authorization);
    const items = await service.list();
    return {
      items: items
        .filter((bounty) => bounty.status !== 'DRAFT' || bounty.ownerUserId === actor?.id)
        .map((bounty) => bountyForViewer(bounty, actor?.id))
    };
  });
  app.get('/api/applications/me', async (request) => {
    const actor = await auth.requireUser(request.headers.authorization);
    const items = await service.listMyApplications(actor);
    return { items: items.map((item) => ({ ...item, bounty: bountyForViewer(item.bounty, actor.id) })) };
  });
  app.get('/api/applications/slots', async (request) => {
    const actor = await auth.requireUser(request.headers.authorization);
    return service.getApplicationSlots(actor);
  });
  app.post<{ Params: { applicationId: string } }>('/api/applications/:applicationId/withdraw', async (request) => {
    const actor = await auth.requireUser(request.headers.authorization);
    return service.withdrawApplication(request.params.applicationId, actor);
  });
  app.get<{ Params: { id: string } }>('/api/bounties/:id', async (request) => {
    const actor = await auth.optionalUser(request.headers.authorization);
    const bounty = await service.get(request.params.id);
    if (bounty.status === 'DRAFT' && bounty.ownerUserId !== actor?.id) {
      throw new DomainError('Bounty not found', 404, 'NOT_FOUND');
    }
    return bountyForViewer(bounty, actor?.id);
  });
  app.get<{ Params: { id: string } }>('/api/bounties/:id/submission-report-evidence', async (request) => {
    const actor = await auth.requireUser(request.headers.authorization);
    return service.getSubmissionReportEvidence(request.params.id, actor);
  });

  app.post('/api/bounties', async (request, reply) => {
    const actor = await auth.requireUser(request.headers.authorization);
    const input = createBountySchema.parse(request.body);
    await walletIdentity.assertLinked(actor, input.ownerAddress);
    const bounty = await service.create(input, actor, readGitHubToken(request.headers['x-github-token']));
    return reply.code(201).send(bounty);
  });

  app.post<{ Params: { id: string } }>('/api/bounties/:id/funded', async (request) => {
    const actor = await auth.requireUser(request.headers.authorization);
    const { onchainId, fundingTxHash } = bountyFundedSchema.parse(request.body);
    return service.markFunded(request.params.id, onchainId, fundingTxHash, actor.id);
  });

  app.post<{ Params: { id: string } }>('/api/bounties/:id/refunded', async (request) => {
    const actor = await auth.requireUser(request.headers.authorization);
    const { refundTxHash } = bountyRefundedSchema.parse(request.body);
    return service.markRefunded(request.params.id, refundTxHash, actor);
  });

  app.post<{ Params: { id: string } }>('/api/bounties/:id/applications', async (request, reply) => {
    const actor = await auth.requireUser(request.headers.authorization);
    const input = createApplicationSchema.parse(request.body);
    await walletIdentity.assertLinked(actor, input.developerAddress);
    return reply.code(201).send(await service.apply(request.params.id, input, actor));
  });

  app.get<{ Params: { id: string } }>('/api/bounties/:id/applications', async (request) => {
    const actor = await auth.requireUser(request.headers.authorization);
    return { items: await service.listApplications(request.params.id, actor) };
  });

  app.post<{ Params: { id: string; applicationId: string } }>('/api/bounties/:id/applications/:applicationId/assign', async (request) => {
    const actor = await auth.requireUser(request.headers.authorization);
    const { assignmentTxHash } = bountyAssignSchema.parse(request.body);
    return service.assign(request.params.id, request.params.applicationId, actor, assignmentTxHash);
  });

  app.post<{ Params: { id: string } }>('/api/bounties/:id/submissions/prepare', async (request) => {
    const actor = await auth.requireUser(request.headers.authorization);
    const input = submitWorkSchema.parse(request.body);
    await walletIdentity.assertLinked(actor, input.developerAddress);
    const { evidence, submissionHash } = await service.prepareSubmission(request.params.id, input, actor);
    return { evidence, submissionHash };
  });

  app.post<{ Params: { id: string } }>('/api/bounties/:id/submissions', async (request, reply) => {
    const actor = await auth.requireUser(request.headers.authorization);
    const input = submitWorkSchema.parse(request.body);
    await walletIdentity.assertLinked(actor, input.developerAddress);
    const result = await service.submit(request.params.id, input, actor);
    if (result.bounty.reviewPaymentStatus === 'PAID') {
      runInBackground(service.runPaidReview(request.params.id).catch((error) => {
        request.log.error(error, 'Automatic Owl Agent review failed');
      }));
    }
    return reply.code(201).send({ ...result, bounty: bountyForViewer(result.bounty, actor.id) });
  });

  app.post<{ Params: { id: string } }>('/api/bounties/:id/review-payment', async (request, reply) => {
    const actor = await auth.requireUser(request.headers.authorization);
    const { targetPlan } = reviewPaymentRequestSchema.parse(request.body);
    const order = await service.createReviewPaymentOrder(request.params.id, actor, targetPlan);
    const paymentRequired = order.x402 ?? order;
    return reply
      .header('PAYMENT-REQUIRED', Buffer.from(JSON.stringify(paymentRequired)).toString('base64'))
      .code(402)
      .send(order);
  });

  app.post<{ Params: { id: string } }>('/api/bounties/:id/review-payment/confirm', async (request) => {
    const actor = await auth.requireUser(request.headers.authorization);
    const { orderId, txHash } = confirmReviewPaymentSchema.parse(request.body);
    const updated = await service.confirmReviewPayment(request.params.id, orderId, txHash as `0x${string}`, actor);
    if (updated.status === 'SUBMITTED' && updated.reviewPaymentStatus === 'PAID') {
      runInBackground(service.runPaidReview(request.params.id).catch((error) => {
        request.log.error(error, 'Automatic upgraded Owl Agent review failed');
      }));
    }
    return updated;
  });

  // Each call spends a billable OpenAI review on the server's own API key.
  app.post<{ Params: { id: string } }>('/api/bounties/:id/review/run', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request) => {
    const actor = await auth.requireUser(request.headers.authorization);
    return service.runAutomatedReview(request.params.id, actor);
  });

  app.post<{ Params: { id: string } }>('/api/bounties/:id/verification', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => {
    if (!env.AGENT_API_KEY || !secretMatches(readHeader(request.headers['x-agent-key']), env.AGENT_API_KEY)) {
      throw new DomainError(
        !env.AGENT_API_KEY ? 'AGENT_API_KEY is not configured' : 'Agent authorization is required',
        401,
        'UNAUTHORIZED'
      );
    }
    const input = verificationInputSchema.parse(request.body);
    return service.verify(request.params.id, input);
  });

  app.post<{ Params: { id: string } }>('/api/bounties/:id/approve', async (request) => {
    const actor = await auth.requireUser(request.headers.authorization);
    return service.approve(request.params.id, actor);
  });

  app.post<{ Params: { id: string } }>('/api/bounties/:id/request-revision', async (request) => {
    const actor = await auth.requireUser(request.headers.authorization);
    return service.requestRevision(request.params.id, actor, requestRevisionSchema.parse(request.body));
  });

  app.post<{ Params: { id: string } }>('/api/bounties/:id/resolution-appeal', async (request) => {
    const actor = await auth.requireUser(request.headers.authorization);
    const input = appealResolutionSchema.parse(request.body);
    return bountyForViewer(await service.appealTimeoutResolution(request.params.id, actor, input.message), actor.id);
  });
}

function readGitHubToken(value: string | string[] | undefined) {
  return readHeader(value);
}

function readHeader(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : '';
}

/**
 * Constant-time secret comparison. Hashing first keeps the comparison length
 * fixed, so neither the secret's length nor its matching prefix leaks through
 * response timing.
 */
function secretMatches(candidate: string | undefined, expected: string) {
  const a = createHash('sha256').update(candidate ?? '').digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
