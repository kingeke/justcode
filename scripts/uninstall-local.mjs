#!/usr/bin/env node
// Removes the local `justcode` symlink created by install-local.mjs.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, rmSync } from 'node:fs';
import { join } from 'node:path';

let binDir;
try {
  binDir = join(
    execFileSync('npm', ['prefix', '-g'], { encoding: 'utf8' }).trim(),
    'bin'
  );
} catch {
  binDir = join(process.env.HOME ?? '.', '.justcode', 'bin');
}

// Clean up an old `npm link` registration too, if present.
try {
  execFileSync('npm', ['rm', '-g', 'justcode'], { stdio: 'ignore' });
} catch {
  /* ignore */
}

// Remove the default link plus any alternate name passed as an argument
// (e.g. `npm run uninstall:local -- justcode-local`).
const names = ['justcode', ...process.argv.slice(2)];
let removed = 0;
for (const name of names) {
  const linkPath = join(binDir, name);
  if (existsSync(linkPath) || isSymlink(linkPath)) {
    rmSync(linkPath, { force: true });
    console.log(`✓ Removed ${linkPath}`);
    removed += 1;
  }
}
if (removed === 0) {
  console.log('Nothing to remove.');
}

function isSymlink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
