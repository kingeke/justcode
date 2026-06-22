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
    coverage: {
      reporter: ['text', 'lcov'],
    },
  },
});
