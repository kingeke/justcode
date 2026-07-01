import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

// The product version comes from the root package.json — the single source of
// truth the CLI and extension also read from — so the site never drifts.
const rootPkg = JSON.parse(
  readFileSync(resolve(here, '../../package.json'), 'utf8')
);

export default defineConfig({
  // GitHub Pages serves a project site under /<repo>/, so assets must be
  // requested from that base. Change if the repo is renamed or served at root.
  base: '/justcode/',
  plugins: [react()],
  resolve: {
    // Reuse the brand constant instead of hard-coding the name a second time.
    alias: { '@core': resolve(here, '../../packages/core/src') },
  },
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
  },
});
