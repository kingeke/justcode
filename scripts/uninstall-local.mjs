#!/usr/bin/env node
// Removes the local `justcode` symlink created by install-local.mjs.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, rmSync } from 'node:fs';
import { join } from 'node:path';

let binDir;
try {
  binDir = join(execFileSync('npm', ['prefix', '-g'], { encoding: 'utf8' }).trim(), 'bin');
} catch {
  binDir = join(process.env.HOME ?? '.', '.justcode', 'bin');
}

// Clean up an old `npm link` registration too, if present.
try {
  execFileSync('npm', ['rm', '-g', 'just-code'], { stdio: 'ignore' });
} catch {
  /* ignore */
}

const linkPath = join(binDir, 'justcode');
if (existsSync(linkPath) || isSymlink(linkPath)) {
  rmSync(linkPath, { force: true });
  console.log(`✓ Removed ${linkPath}`);
} else {
  console.log('Nothing to remove.');
}

function isSymlink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
