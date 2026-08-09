import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url))
    }
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: ['lib/**/*.ts', 'hooks/**/*.ts', 'components/**/*.tsx'],
      exclude: ['**/*.test.ts', '**/*.test.tsx'],
      // This deliberately records the current UI-test debt instead of hiding
      // untested components. Raise these floors as component tests are added.
      thresholds: {
        statements: 8,
        branches: 70,
        functions: 35,
        lines: 8
      }
    }
  }
});
