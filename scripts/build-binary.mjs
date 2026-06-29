#!/usr/bin/env node
// Compiles a self-contained JustCode executable for the HOST platform into
// dist-bin/. The binary embeds the Bun runtime and @opentui's native library,
// so it runs with no Bun, Node, or node_modules present.
//
// Cross-compilation is intentionally not attempted: @opentui ships its native
// library as a platform-gated optional dependency, so only the host's library
// is installed. Each target is built on its own runner in CI
// (see .github/workflows/release.yml).
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assetName, bunTarget } from './lib/platform.mjs';

// Regenerate the embedded tree-sitter worker so it matches the installed OpenTUI
// (the binary needs a self-contained worker for markdown highlighting to work;
// see build-tree-sitter-worker.mjs). Done before compile so the file is embedded.
const here = dirname(fileURLToPath(import.meta.url));
const worker = spawnSync('node', [join(here, 'build-tree-sitter-worker.mjs')], {
  stdio: 'inherit',
});
if (worker.status !== 0) process.exit(worker.status ?? 1);

const outDir = 'dist-bin';
const out = join(outDir, assetName());
mkdirSync(outDir, { recursive: true });

console.log(`Building ${out} (${bunTarget()})...`);

const result = spawnSync(
  'bun',
  [
    'build',
    'apps/cli/src/index.tsx',
    '--compile',
    `--target=${bunTarget()}`,
    '--outfile',
    out,
  ],
  { stdio: 'inherit' }
);

if (result.error) {
  console.error(`Failed to run bun: ${result.error.message}`);
  console.error('Bun is required to build the binary: https://bun.sh');
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`\n✓ ${out}`);
