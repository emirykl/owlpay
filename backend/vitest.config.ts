import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['test/**/*.cjs', 'node_modules/**', 'dist/**', 'artifacts/**'],
    env: {
      NODE_ENV: 'test',
      PERSISTENCE_MODE: 'memory',
      SUPABASE_URL: '',
      SUPABASE_SECRET_KEY: '',
      AGENT_API_KEY: ''
    }
  }
});
