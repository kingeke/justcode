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

/**
 * Garbage-collects resolutions for sessions that no longer exist. Entries are
 * otherwise only dropped on explicit session deletion, so sessions that vanish
 * any other way leave their (baseline-heavy) entries behind forever and the
 * store grows unbounded. Called with the live session ids whenever the sessions
 * list is rebuilt. Best-effort; only writes when something was actually pruned.
 */
export async function pruneResolvedFiles(
  cacheDir: string,
  liveSessionIds: Iterable<string>
): Promise<void> {
  try {
    const store = await readStore(cacheDir);
    const live = new Set(liveSessionIds);
    let changed = false;
    for (const sessionId of Object.keys(store)) {
      if (!live.has(sessionId)) {
        delete store[sessionId];
        changed = true;
      }
    }
    if (!changed) return;
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      storePath(cacheDir),
      `${JSON.stringify(store, null, 2)}\n`,
      'utf8'
    );
  } catch {
    // Best-effort: a failed prune must never break the chat.
  }
}
