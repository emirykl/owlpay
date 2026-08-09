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
      // The branch floor sits below the others on purpose. Covering a large,
      // branch-heavy component raises the count of covered branches while
      // raising the total faster, so the ratio can fall even as the tests get
      // better: reaching into bounty-detail took covered branches from 248 to
      // 369 and the percentage from 75 to 68. Judge this line by the absolute
      // count moving up, not by the ratio alone.
      thresholds: {
        statements: 49,
        branches: 68,
        functions: 44,
        lines: 49
      }
    }
  }
});
