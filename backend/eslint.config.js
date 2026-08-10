import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `coverage/` holds generated reports; solidity-coverage writes bundled
  // vendor scripts into its HTML output that no lint rule should judge.
  { ignores: ['dist/**', 'artifacts/**', 'cache/**', 'coverage/**', '.vercel/**', '**/*.cjs'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['error', 'warn'] }],
      'prefer-const': 'error'
    }
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error'
    }
  }
);
