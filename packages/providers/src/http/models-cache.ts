import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

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

const CACHE_DIR = join(homedir(), '.cache', 'justcode');
const CACHE_FILE = join(CACHE_DIR, 'models.json');

async function readCacheFile(): Promise<ModelsCacheFile> {
  try {
    return JSON.parse(await readFile(CACHE_FILE, 'utf8')) as ModelsCacheFile;
  } catch {
    // Missing or unreadable cache — treat as empty so callers refetch.
    return {};
  }
}

async function writeCacheEntry(
  providerId: string,
  models: ModelInfo[]
): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const existing = await readCacheFile();
    existing[providerId] = { fetchedAt: new Date().toISOString(), models };
    await writeFile(
      CACHE_FILE,
      JSON.stringify(existing, null, 2) + '\n',
      'utf8'
    );
  } catch {
    // Best-effort: a failed cache write must never break listing models.
  }
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
 * `local` providers are returned unwrapped (always refetched). All other methods
 * delegate straight through.
 */
export function withModelsCache(
  inner: ProviderClient,
  options: { local: boolean }
): ProviderClient {
  if (options.local) return inner;
  return new CachingModelsClient(inner);
}

class CachingModelsClient implements ProviderClient {
  public readonly providerId: ProviderId;

  public constructor(private readonly inner: ProviderClient) {
    this.providerId = inner.providerId;
  }

  public sendChat: ProviderClient['sendChat'] = (request) =>
    this.inner.sendChat(request);

  public getDefaultModel(): string | undefined {
    return this.inner.getDefaultModel();
  }

  public async listModels(): Promise<ModelInfo[]> {
    const id = String(this.inner.providerId);
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
