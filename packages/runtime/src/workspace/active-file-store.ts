import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { cacheDirectory } from '@core/application/cache-dir';

/**
 * A tiny shared sidecar that lets the VSCode extension tell a CLI running in the
 * same workspace which file is open in the editor, so `@currentfile` works in
 * both. The extension writes the active editor's path here on every tab switch;
 * a CLI reads it live. Keyed by workspace root so multiple projects don't clash.
 */
type ActiveFileStore = Record<string, string>;

function storePath(): string {
  return join(cacheDirectory(), 'active-files.json');
}

function readStore(): ActiveFileStore {
  try {
    return JSON.parse(readFileSync(storePath(), 'utf8')) as ActiveFileStore;
  } catch {
    return {};
  }
}

/**
 * The workspace-relative path the editor last reported as open for this
 * workspace root, or undefined when none is recorded (or the store is missing).
 */
export function readActiveFile(workspaceRoot: string): string | undefined {
  const path = readStore()[workspaceRoot];
  return path && path.length > 0 ? path : undefined;
}

/**
 * Records (or, when `relativePath` is undefined, clears) the file open in the
 * editor for a workspace root. Best-effort: failures are swallowed since this is
 * a convenience channel, not a source of truth.
 */
export function writeActiveFile(
  workspaceRoot: string,
  relativePath: string | undefined
): void {
  const store = readStore();
  if (relativePath) {
    store[workspaceRoot] = relativePath;
  } else {
    delete store[workspaceRoot];
  }
  try {
    mkdirSync(cacheDirectory(), { recursive: true });
    writeFileSync(storePath(), `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  } catch {
    // A read-only cache dir just means the channel is unavailable; ignore.
  }
}
