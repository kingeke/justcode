#!/usr/bin/env node
// npm/pnpm/bun entry point. This thin launcher runs under Node (which the
// package managers already provide) and execs the self-contained JustCode
// binary for the current platform. The binary embeds the Bun runtime, so end
// users need neither Bun nor Node beyond this launcher.
//
// The binary is normally fetched during postinstall; if that was skipped (some
// setups disable install scripts), it is downloaded lazily on first run.
import { spawn } from 'node:child_process';

import {
  defaultBinaryPath,
  ensureBinary,
} from '../scripts/lib/download-binary.mjs';

let binary = defaultBinaryPath();
try {
  binary = await ensureBinary(binary);
} catch (err) {
  console.error(
    `[justcode] Could not obtain the platform binary: ${err.message}`
  );
  process.exit(1);
}

const child = spawn(binary, process.argv.slice(2), { stdio: 'inherit' });
child.on('error', (err) => {
  console.error(`[justcode] Failed to launch: ${err.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
