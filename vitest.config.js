import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
const rootDir = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  resolve: {
    alias: {
      '@cli': resolve(rootDir, 'apps/cli/src'),
      '@core': resolve(rootDir, 'packages/core/src'),
      '@providers': resolve(rootDir, 'packages/providers/src'),
      '@runtime': resolve(rootDir, 'packages/runtime/src'),
    },
  },
  test: {
    environment: 'node',
    // Redirects cache writes to a throwaway folder so tests never touch the
    // real ~/.cache/justcode. Kept in sync with vitest.config.ts.
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      reporter: ['text', 'lcov'],
    },
  },
});
