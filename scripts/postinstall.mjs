#!/usr/bin/env node
// Runs after `npm/pnpm/bun install` of the published package: downloads the
// prebuilt binary for the current platform. Skipped when installing inside the
// source repo (developers build locally with `npm run build:binary`) and when
// JUSTCODE_SKIP_DOWNLOAD is set.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultBinaryPath, ensureBinary } from './lib/download-binary.mjs';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');

// In the source checkout the CLI sources are present; don't fetch a release.
if (existsSync(join(pkgDir, 'apps', 'cli', 'src', 'index.tsx'))) {
  process.exit(0);
}
if (process.env.JUSTCODE_SKIP_DOWNLOAD) {
  process.exit(0);
}

try {
  await ensureBinary(defaultBinaryPath());
} catch (err) {
  // Don't fail the install; the launcher will retry on first run.
  console.warn(`[just-code] postinstall could not download the binary now (${err.message}); it will be fetched on first run.`);
}
