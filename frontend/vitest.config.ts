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
      // These record the current UI-test debt instead of hiding untested
      // components. Raise them as component tests are added.
      //
      // Read a falling branch ratio carefully before treating it as a
      // regression: covering a large, branch-heavy component adds covered
      // branches but adds to the total faster, so the percentage can drop while
      // the tests genuinely improve. Reaching into bounty-detail took covered
      // branches from 248 to 369 and the ratio from 75 to 68. Judge that line
      // by the absolute count moving up as well.
      //
      // The function floor trails the rest because the untested components that
      // remain are dense with small handlers, and one uncovered component costs
      // far more here than it does in the statement count.
      thresholds: {
        statements: 71,
        branches: 71,
        functions: 50,
        lines: 71
      }
    }
  }
});
