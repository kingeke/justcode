import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { cacheDirectory } from '@core/application/cache-dir';
import type { ModelInfo, ProviderClient } from '@core/ports/chat-model';
import type { ProviderId } from '@core/ports/provider-catalog';

/**
 * On-disk cache for the per-provider model list. Remote providers rarely change
 * their catalog, yet every app start refetches all of them — a network round
 * trip per provider. We cache the fetched list with a timestamp and reuse it for
 * the rest of the calendar day; local providers (Ollama/LM Studio) are never
 * cached since they're free to query and change as the user pulls models.
 */
interface CachedProviderModels {
  /** ISO timestamp of when this list was fetched. */
  fetchedAt: string;
  models: ModelInfo[];
}

type ModelsCacheFile = Record<string, CachedProviderModels>;

// Resolved lazily (not at import time) so tests that set JUSTCODE_CACHE_DIR in a
// setup file take effect even though this module is imported afterwards.
const cacheDir = (): string => cacheDirectory();
const cacheFile = (): string => join(cacheDir(), 'models.json');

/**
 * Deletes the on-disk model-list cache so the next `listModels()` refetches from
 * every provider. Backs a manual "refresh models" action. Best-effort: a missing
 * or unremovable file is ignored.
 */
export async function clearModelsCache(): Promise<void> {
  try {
    await rm(cacheFile(), { force: true });
  } catch {
    // Nothing to clear, or the file couldn't be removed — refetch anyway.
  }
}

async function readCacheFile(): Promise<ModelsCacheFile> {
  try {
    return JSON.parse(await readFile(cacheFile(), 'utf8')) as ModelsCacheFile;
  } catch {
    // Missing or unreadable cache — treat as empty so callers refetch.
    return {};
  }
}

// Serializes the read-modify-write of the shared cache file. `listModels()` is
// called concurrently (one per provider) during the startup fan-out, so without
// this every cache-miss writer would read the file, splice in its own entry, and
// write the whole thing back at the same time — overlapping writers clobber each
// other's entries and `writeFile`'s truncate-then-write can interleave into
// invalid JSON. Chaining each write onto the previous one makes them run one at a
// time within the process.
let writeChain: Promise<void> = Promise.resolve();

async function writeCacheEntry(
  providerId: string,
  models: ModelInfo[]
): Promise<void> {
  const run = writeChain.then(async () => {
    try {
      await mkdir(cacheDir(), { recursive: true });
      const existing = await readCacheFile();
      existing[providerId] = { fetchedAt: new Date().toISOString(), models };
      // Write to a unique temp file then atomically rename over the target, so a
      // reader (or another process) never observes a half-written file, and a
      // crash mid-write can't leave the cache truncated. The temp name carries
      // pid + random bytes to stay unique across processes.
      const tmp = `${cacheFile()}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
      await writeFile(tmp, JSON.stringify(existing, null, 2) + '\n', 'utf8');
      await rename(tmp, cacheFile());
    } catch {
      // Best-effort: a failed cache write must never break listing models.
    }
  });
  // Keep the chain alive regardless of this write's outcome (errors are already
  // swallowed above, but guard so a rejection can't break the next writer).
  writeChain = run.catch(() => {});
  return run;
}

/** True when {@link iso} falls on the same calendar day as {@link now}. */
function isSameDay(iso: string, now = new Date()): boolean {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return false;
  return (
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate()
  );
}

/**
 * Decorates {@link inner} so `listModels()` is served from the once-a-day cache.
 *
 * `local` providers (Ollama/LM Studio) refetch on every call by default, since
 * their catalog changes as the user pulls models. That live refresh can be
 * turned off via {@link Options.autoRefreshLocal}, in which case local providers
 * fall back to the same once-a-day cache remote providers use. The toggle is
 * read per call (not at construction) so flipping it takes effect immediately on
 * already-created clients. All non-list methods delegate straight through.
 */
export function withModelsCache(
  inner: ProviderClient,
  options: {
    local: boolean;
    /** Whether local providers should refetch every call; defaults to true. */
    autoRefreshLocal?: () => boolean;
  }
): ProviderClient {
  return new CachingModelsClient(
    inner,
    options.local,
    options.autoRefreshLocal
  );
}

class CachingModelsClient implements ProviderClient {
  public readonly providerId: ProviderId;

  public constructor(
    private readonly inner: ProviderClient,
    private readonly local: boolean,
    private readonly autoRefreshLocal: () => boolean = () => true
  ) {
    this.providerId = inner.providerId;
  }

  public sendChat: ProviderClient['sendChat'] = (request) =>
    this.inner.sendChat(request);

  public getDefaultModel(): string | undefined {
    return this.inner.getDefaultModel();
  }

  public async listModels(): Promise<ModelInfo[]> {
    const id = String(this.inner.providerId);

    // Local providers refetch live unless the user disabled auto-refresh; when
    // disabled they share the same once-a-day cache path as remote providers.
    if (this.local && this.autoRefreshLocal()) {
      return this.inner.listModels();
    }

    const cache = await readCacheFile();
    const cached = cache[id];
    if (cached && isSameDay(cached.fetchedAt)) {
      return cached.models;
    }

    try {
      const models = await this.inner.listModels();
      await writeCacheEntry(id, models);
      return models;
    } catch (error) {
      // Network/auth failure: fall back to a stale list rather than showing no
      // models at all. Only rethrow when there's nothing cached to serve.
      if (cached) return cached.models;
      throw error;
    }
  }
}
