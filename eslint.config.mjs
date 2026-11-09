// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      'references/**',
      // Prisma client emitted beside the schema. The declaration file is large
      // enough that linting it exhausts the Node heap.
      '**/generated/prisma/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-console': 'error',
    },
  },
  {
    files: ['packages/config/src/logger.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Standalone Node scripts run directly via `node scripts/*.mjs` (not
    // compiled/typed as part of any package's TS project), so they need
    // Node globals declared and are exempt from no-console the same way
    // the logger module is — there is no structured logger available at
    // this point in the toolchain (pre-migration sanity checks).
    files: ['**/scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
);
