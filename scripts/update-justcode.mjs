#!/usr/bin/env node
// Updates the *installed* `justcode` binary — the real one on PATH (e.g.
// ~/.justcode/bin/justcode from the curl installer) — with a fresh build of
// this repo.
//
// Unlike install-local.mjs, which symlinks dist-bin onto PATH so the command
// tracks every rebuild (the `justcode-local` workflow), this COPIES the built
// binary over the installed one. The installed `justcode` therefore stays
// stable until you deliberately run this again, independent of local dev
// rebuilds.
//
//   npm run update:justcode
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assetName } from './lib/platform.mjs';

const repoDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Whether `path` (already resolved) lives inside `dir`. */
function isInside(path, dir) {
  return path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep);
}

/**
 * Picks where the installed `justcode` lives, given every `justcode` found on
 * PATH. Candidates are `{ path, realPath }` (realPath = symlinks resolved).
 * Anything that resolves into this repo is the local dev link
 * (install-local.mjs's symlink into dist-bin), not the actual install, so it
 * is skipped. Falls back to `defaultPath` (the curl installer's location) when
 * nothing else is found.
 */
export function pickInstallTarget(candidates, { repoDir: repo, defaultPath }) {
  for (const candidate of candidates) {
    const resolved = candidate.realPath ?? candidate.path;
    if (isInside(resolved, repo)) continue;
    return candidate.path;
  }
  return defaultPath;
}

/** Every `justcode` on PATH, in resolution order (empty when none). */
function whichAll(command) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const args = process.platform === 'win32' ? [command] : ['-a', command];
  try {
    return execFileSync(finder, args, { encoding: 'utf8' })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function safeRealpath(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function main() {
  // 1. Build the self-contained binary for this platform.
  execFileSync('node', ['scripts/build-binary.mjs'], {
    stdio: 'inherit',
    cwd: repoDir,
  });
  const binaryPath = join(repoDir, 'dist-bin', assetName());
  if (!existsSync(binaryPath)) {
    console.error(`[justcode] expected binary not found at ${binaryPath}`);
    process.exit(1);
  }

  // 2. Find the installed `justcode` (skipping any local dev symlink into
  //    this repo); default to the curl installer's location.
  const ext = process.platform === 'win32' ? '.exe' : '';
  const defaultPath = join(homedir(), '.justcode', 'bin', `justcode${ext}`);
  const candidates = whichAll('justcode').map((path) => ({
    path,
    realPath: safeRealpath(path),
  }));
  const target = pickInstallTarget(candidates, { repoDir, defaultPath });

  // 3. Copy next to the target, then rename over it — atomic-ish, and safe to
  //    run while the old binary is executing.
  mkdirSync(dirname(target), { recursive: true });
  const staging = `${target}.tmp-${process.pid}`;
  copyFileSync(binaryPath, staging);
  chmodSync(staging, 0o755);
  renameSync(staging, target);

  console.log(`\n✓ Updated: ${target} (copied from ${binaryPath})`);
  console.log(
    'Your justcode-local symlink (if any) is untouched and still tracks dist-bin.'
  );
}

// Only run when invoked directly, so tests can import `pickInstallTarget`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
