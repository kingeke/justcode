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
  // Served at the root of the custom domain (justcodeapp.dev), so assets are
  // requested from '/'. The CNAME in public/ keeps the domain across deploys.
  // Revert to '/<repo>/' if the site ever moves back to a GitHub project path.
  base: '/',
  plugins: [react()],
  resolve: {
    // Reuse the brand constant instead of hard-coding the name a second time.
    alias: { '@core': resolve(here, '../../packages/core/src') },
  },
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
  },
});
