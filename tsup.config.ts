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
  // Keep @opentui/core external: it resolves its native dylib, wasm, and
  // tree-sitter assets relative to its own location via import.meta.url, which
  // breaks if bundled. But bundle @opentui/react and react-reconciler so
  // esbuild rewrites their extensionless `react-reconciler/constants` imports
  // (Node's strict ESM loader rejects extensionless specifiers; bun tolerates
  // them, which is why `npm run dev` works but the built binary did not).
  // The embedded tree-sitter worker is imported with `with { type: 'file' }`, a
  // bun-only loader esbuild can't parse. The distributed binary is built by `bun
  // build --compile` (build:binary), not tsup, so keep this import external here;
  // tsup's dist/ output is not the shipped artifact.
  external: ['@opentui/core', '@cli/generated/tree-sitter-worker.js'],
  // react / react-reconciler are CJS and use `require("react")` internally;
  // bundling them together (with @opentui/react) keeps a single React instance
  // and avoids "Dynamic require of react is not supported" in the ESM output.
  // Safe because @opentui/core (external) does not depend on React.
  noExternal: ['@opentui/react', 'react-reconciler', 'react'],
  // The CLI runs under Bun, not Node: @opentui/core's terminal renderer needs
  // FFI (bun:ffi), which Node does not provide. The build still bundles for the
  // ESM/node target above, but the produced binary is executed by Bun.
  banner: {
    js: '#!/usr/bin/env bun',
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
