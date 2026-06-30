import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { WebviewResolvedFile } from '@ext/shared/protocol';

/**
 * Persists the changes-panel resolutions (kept/undone files) per session, so
 * reopening a chat doesn't resurface edits the user already reviewed. Stored as a
 * single sidecar `resolved-files.json` in the cache dir, keyed by session id.
 *
 * Best-effort throughout: a missing/corrupt store reads as empty, and a failed
 * write is swallowed — losing UI dismissals must never break the chat.
 */

type SessionResolved = Record<string, WebviewResolvedFile>;
type Store = Record<string, SessionResolved>;

function storePath(cacheDir: string): string {
  return join(cacheDir, 'resolved-files.json');
}

async function readStore(cacheDir: string): Promise<Store> {
  try {
    return JSON.parse(await readFile(storePath(cacheDir), 'utf8')) as Store;
  } catch {
    return {};
  }
}

export async function readResolvedFiles(
  cacheDir: string,
  sessionId: string
): Promise<SessionResolved> {
  const store = await readStore(cacheDir);
  return store[sessionId] ?? {};
}

export async function writeResolvedFiles(
  cacheDir: string,
  sessionId: string,
  resolved: SessionResolved
): Promise<void> {
  try {
    await mkdir(cacheDir, { recursive: true });
    const store = await readStore(cacheDir);
    // An empty map means "nothing resolved" — drop the key so the file doesn't
    // accumulate dead session entries.
    if (Object.keys(resolved).length === 0) {
      delete store[sessionId];
    } else {
      store[sessionId] = resolved;
    }
    await writeFile(
      storePath(cacheDir),
      `${JSON.stringify(store, null, 2)}\n`,
      'utf8'
    );
  } catch {
    // Best-effort: a failed write must never break the chat.
  }
}

/** Drops a session's resolutions, e.g. when the session is deleted. */
export async function deleteResolvedFiles(
  cacheDir: string,
  sessionId: string
): Promise<void> {
  await writeResolvedFiles(cacheDir, sessionId, {});
}
