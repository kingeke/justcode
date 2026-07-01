import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { WebviewToolView } from '@ext/shared/protocol';

/**
 * Persists the tool views captured while a turn ran — crucially the pre-edit
 * diffs — per session. A diff can't be recomputed once the file is changed on
 * disk (the old text is gone), so without this the changes panel and tool cards
 * lose their diffs the moment the webview/host reloads. Stored as a sidecar
 * `tool-views.json` in the cache dir, keyed by session id then tool-call id.
 *
 * Best-effort throughout: a missing/corrupt store reads as empty and a failed
 * write is swallowed — a lost diff must never break the chat.
 */

type SessionViews = Record<string, WebviewToolView>;
type Store = Record<string, SessionViews>;

function storePath(cacheDir: string): string {
  return join(cacheDir, 'tool-views.json');
}

async function readStore(cacheDir: string): Promise<Store> {
  try {
    return JSON.parse(await readFile(storePath(cacheDir), 'utf8')) as Store;
  } catch {
    return {};
  }
}

export async function readToolViews(
  cacheDir: string,
  sessionId: string
): Promise<Map<string, WebviewToolView>> {
  const store = await readStore(cacheDir);
  return new Map(Object.entries(store[sessionId] ?? {}));
}

export async function writeToolViews(
  cacheDir: string,
  sessionId: string,
  views: ReadonlyMap<string, WebviewToolView>
): Promise<void> {
  try {
    await mkdir(cacheDir, { recursive: true });
    const store = await readStore(cacheDir);
    if (views.size === 0) {
      delete store[sessionId];
    } else {
      store[sessionId] = Object.fromEntries(views);
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

/** Drops a session's captured views, e.g. when the session is deleted. */
export async function deleteToolViews(
  cacheDir: string,
  sessionId: string
): Promise<void> {
  await writeToolViews(cacheDir, sessionId, new Map());
}

/**
 * Garbage-collects captured views for sessions that no longer exist. Like the
 * resolved-files store, entries are otherwise only dropped on explicit session
 * deletion, so orphaned sessions accumulate diff snapshots forever. Called with
 * the live session ids whenever the sessions list is rebuilt. Best-effort; only
 * writes when something was actually pruned.
 */
export async function pruneToolViews(
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
