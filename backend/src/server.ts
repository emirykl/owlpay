import Fastify from 'fastify';
import { buildApp } from './create-app.js';
import { env } from './config/env.js';

// Vercel's Fastify adapter detects a direct Fastify import in the server
// entrypoint. Passing the factory keeps app construction independently testable.
const app = buildApp(Fastify);

const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}, shutting down gracefully`);
  const timeout = setTimeout(() => {
    app.log.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10_000);
  timeout.unref();
  try {
    await app.close();
    process.exit(0);
  } catch (error: unknown) {
    app.log.error(error, 'Error during graceful shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

app.listen({ port: env.PORT, host: env.HOST }).catch((error: unknown) => {
  app.log.error(error);
  process.exit(1);
});
