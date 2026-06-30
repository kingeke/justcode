import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ModelInfo, ProviderClient } from '@core/ports/chat-model';
import { ProviderId } from '@core/ports/provider-catalog';

import { withModelsCache } from '@providers/http/models-cache';

/** A provider stub whose `listModels` resolves after a tick, so concurrent
 * cache-miss writers genuinely overlap. */
function fakeProvider(
  providerId: ProviderId,
  models: ModelInfo[]
): ProviderClient {
  return {
    providerId,
    sendChat: async () => ({ content: '' }),
    getDefaultModel: () => models[0]?.id,
    listModels: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return models;
    },
  };
}

function model(id: string, providerId: ProviderId): ModelInfo {
  return { id, displayName: id, providerId };
}

describe('models cache', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'models-cache-'));
    process.env.JUSTCODE_CACHE_DIR = dir;
  });

  afterEach(async () => {
    delete process.env.JUSTCODE_CACHE_DIR;
    await rm(dir, { recursive: true, force: true });
  });

  it('keeps the cache file valid JSON when many providers write at once', async () => {
    // Mirror the startup fan-out: every provider lists concurrently, and on a
    // cold cache each one writes its entry into the shared models.json. Without
    // serialized, atomic writes these races corrupt the file or drop entries.
    const providers = [
      withModelsCache(
        fakeProvider(ProviderId.OpenRouter, [
          model('openai/gpt-5', ProviderId.OpenRouter),
        ]),
        { local: false }
      ),
      withModelsCache(
        fakeProvider(ProviderId.Copilot, [model('claude', ProviderId.Copilot)]),
        { local: false }
      ),
      withModelsCache(
        fakeProvider(ProviderId.Openai, [model('gpt-4', ProviderId.Openai)]),
        { local: false }
      ),
    ];

    await Promise.all(providers.map((p) => p.listModels()));

    const raw = await readFile(join(dir, 'models.json'), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, { models: ModelInfo[] }>;

    // No entry was clobbered by an overlapping writer.
    expect(Object.keys(parsed).sort()).toEqual(
      [ProviderId.OpenRouter, ProviderId.Copilot, ProviderId.Openai].sort()
    );
  });

  it('serves a same-day cached list without refetching', async () => {
    let fetches = 0;
    const inner: ProviderClient = {
      providerId: ProviderId.OpenRouter,
      sendChat: async () => ({ content: '' }),
      getDefaultModel: () => undefined,
      listModels: async () => {
        fetches += 1;
        return [model('openai/gpt-5', ProviderId.OpenRouter)];
      },
    };
    const cached = withModelsCache(inner, { local: false });

    await cached.listModels();
    await cached.listModels();

    expect(fetches).toBe(1);
  });
});
