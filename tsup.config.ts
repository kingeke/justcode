import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'tsup';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  entry: {
    justcode: 'apps/cli/src/index.tsx',
  },
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  clean: true,
  minify: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
  esbuildOptions(options) {
    options.alias = {
      '@cli': resolve(rootDir, 'apps/cli/src'),
      '@core': resolve(rootDir, 'packages/core/src'),
      '@providers': resolve(rootDir, 'packages/providers/src'),
      '@runtime': resolve(rootDir, 'packages/runtime/src'),
    };
    options.outExtension = { '.js': '.js' };
  },
});
