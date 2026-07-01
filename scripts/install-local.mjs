#!/usr/bin/env node
// Local install: build the host binary and symlink it onto PATH as `justcode`.
// Mirrors the published experience (a self-contained binary, no Bun needed at
// runtime). Re-run `npm run update:local` after code changes to refresh it.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assetName } from './lib/platform.mjs';

const repoDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', cwd: repoDir, ...opts });

// 1. Build the self-contained binary for this platform.
run('node', ['scripts/build-binary.mjs']);

const binaryPath = join(repoDir, 'dist-bin', assetName());
if (!existsSync(binaryPath)) {
  console.error(`[justcode] expected binary not found at ${binaryPath}`);
  process.exit(1);
}

// 2. Resolve a bin directory that is on PATH (npm's global prefix bin).
let binDir;
try {
  const prefix = execFileSync('npm', ['prefix', '-g'], {
    encoding: 'utf8',
  }).trim();
  binDir = join(prefix, 'bin');
} catch {
  binDir = join(process.env.HOME ?? '.', '.justcode', 'bin');
}
mkdirSync(binDir, { recursive: true });

// 3. Remove any prior install (including an old `npm link`) and symlink.
try {
  execFileSync('npm', ['rm', '-g', 'justcode'], { stdio: 'ignore' });
} catch {
  /* nothing to unlink */
}
const linkPath = join(binDir, 'justcode');
rmSync(linkPath, { force: true });
symlinkSync(binaryPath, linkPath);

console.log(`\n✓ Installed: ${linkPath} -> ${binaryPath}`);
if (!(process.env.PATH ?? '').split(':').includes(binDir)) {
  console.log(`\n⚠ ${binDir} is not on your PATH. Add it, e.g.:`);
  console.log(
    `    echo 'export PATH="${binDir}:$PATH"' >> ~/.zshrc && source ~/.zshrc`
  );
} else {
  console.log(
    "Run 'justcode' from any terminal. Re-run 'npm run update:local' after code changes."
  );
}
