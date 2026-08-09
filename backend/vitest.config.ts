import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['test/**/*.cjs', 'node_modules/**', 'dist/**', 'artifacts/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: ['src/**/*.ts'],
      // server.ts only wires the process together and env.ts throws at import
      // time; neither has behaviour a unit test can meaningfully assert.
      exclude: ['src/server.ts', 'src/config/env.ts'],
      thresholds: {
        statements: 78,
        branches: 60,
        functions: 70,
        lines: 78
      }
    },
    env: {
      NODE_ENV: 'test',
      PERSISTENCE_MODE: 'memory',
      SUPABASE_URL: '',
      SUPABASE_SECRET_KEY: '',
      AGENT_API_KEY: ''
    }
  }
});
