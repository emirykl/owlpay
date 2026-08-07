import Fastify from 'fastify';
import { buildApp } from './create-app.js';
import { env } from './config/env.js';

// Vercel's Fastify adapter detects a direct Fastify import in the server
// entrypoint. Passing the factory keeps app construction independently testable.
const app = buildApp(Fastify);

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
