import { afterEach, describe, expect, it, vi } from 'vitest';

import { LmStudioProvider } from '@providers/lmstudio/lmstudio-provider';
import { OllamaProvider } from '@providers/ollama/ollama-provider';

function createJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
  });
}

describe('provider clients', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists Ollama models from the local catalog', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        models: [{ name: 'codellama:13b' }, { name: 'llama3.1:8b' }],
      })
    );

    vi.stubGlobal('fetch', fetchMock);

    const models = await new OllamaProvider(
      'http://127.0.0.1:11434'
    ).listModels();

    expect(models).toEqual([
      { id: 'codellama:13b', displayName: 'codellama:13b' },
      { id: 'llama3.1:8b', displayName: 'llama3.1:8b' },
    ]);
  });

  it('lists LM Studio models from the OpenAI-compatible endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        data: [{ id: 'qwen2.5-coder-7b' }, { id: 'mistral-small' }],
      })
    );

    vi.stubGlobal('fetch', fetchMock);

    const models = await new LmStudioProvider(
      'http://127.0.0.1:1234/v1'
    ).listModels();

    expect(models).toEqual([
      { id: 'mistral-small', displayName: 'mistral-small' },
      { id: 'qwen2.5-coder-7b', displayName: 'qwen2.5-coder-7b' },
    ]);
  });
});
