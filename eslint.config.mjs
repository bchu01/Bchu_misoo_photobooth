import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * One flat config for the whole workspace.
 *
 * Type-aware linting is deliberately off: `typecheck` already runs the compiler
 * on every package, and this keeps `lint` fast enough to run on every change.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/next-env.d.ts',
      'packages/shared/dist/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Promises are intentionally fired and forgotten in a few event handlers,
      // always with their own catch; `void` marks those call sites.
      'no-void': 'off',
      eqeqeq: ['error', 'smart'],
      'no-console': 'off',
    },
  },

  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,
      // Captured frames are in-memory blob URLs, which next/image cannot optimise.
      '@next/next/no-img-element': 'off',
      // App Router only; there is no `pages/` directory for this rule to scan.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },

  {
    files: ['apps/signaling/**/*.ts'],
    rules: {
      // The signaling service is the one place allowed to log.
      'no-console': 'off',
    },
  },
);
