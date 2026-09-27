import { defineConfig } from 'vitest/config';

/**
 * Tests cover the rules that are easy to break and expensive to get wrong:
 * strip geometry and export ordering, and room lifecycle/authorization.
 *
 * `@bchu/shared` resolves through the workspace symlink to its built output, so
 * `npm test` builds it first (see the root `pretest` script).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
