import { afterEach, describe, expect, it, vi } from 'vitest';

import { LmStudioProvider } from '@providers/lmstudio/lmstudio-provider';
import { OllamaProvider } from '@providers/ollama/ollama-provider';
import { OpenRouterProvider } from '@providers/openrouter/openrouter-provider';
import { ProviderId } from '@core/ports/chat-model';

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

  it('lists Ollama models from the OpenAI-compatible endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        data: [{ id: 'codellama:13b' }, { id: 'llama3.1:8b' }],
      })
    );

    vi.stubGlobal('fetch', fetchMock);

    const models = await new OllamaProvider(
      'http://127.0.0.1:11434'
    ).listModels();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/v1/models',
      expect.anything()
    );
    expect(models).toEqual([
      {
        id: 'codellama:13b',
        displayName: 'codellama:13b',
        providerId: 'ollama',
      },
      { id: 'llama3.1:8b', displayName: 'llama3.1:8b', providerId: 'ollama' },
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
      {
        id: 'mistral-small',
        displayName: 'mistral-small',
        providerId: ProviderId.LmStudio,
      },
      {
        id: 'qwen2.5-coder-7b',
        displayName: 'qwen2.5-coder-7b',
        providerId: ProviderId.LmStudio,
      },
    ]);
  });

  it('lists OpenRouter models from the catalog', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        data: [
          {
            id: 'mistralai/mistral-7b-instruct',
            name: 'Mistral 7B Instruct',
            context_length: 32768,
          },
          {
            id: 'anthropic/claude-3-haiku',
            name: 'Claude 3 Haiku',
            context_length: 200000,
          },
        ],
      })
    );

    vi.stubGlobal('fetch', fetchMock);

    const models = await new OpenRouterProvider('test-api-key').listModels();

    expect(models).toEqual([
      {
        id: 'anthropic/claude-3-haiku',
        displayName: 'Claude 3 Haiku',
        contextWindow: 200000,
        providerId: ProviderId.OpenRouter,
      },
      {
        id: 'mistralai/mistral-7b-instruct',
        displayName: 'Mistral 7B Instruct',
        contextWindow: 32768,
        providerId: ProviderId.OpenRouter,
      },
    ]);
  });
});
