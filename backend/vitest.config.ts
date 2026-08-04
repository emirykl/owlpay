import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['test/**/*.cjs', 'node_modules/**', 'dist/**', 'artifacts/**']
  }
});

