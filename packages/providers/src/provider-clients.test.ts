import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LmStudioProvider } from '@providers/lmstudio/lmstudio-provider';
import { OllamaProvider } from '@providers/ollama/ollama-provider';
import { OpenRouterProvider } from '@providers/openrouter/openrouter-provider';
import { OpenAiCompatibleProvider } from '@providers/openai-compatible/openai-compatible-provider';
import { ProviderId } from '@core/ports/provider-catalog';
import { ReasoningEffort } from '@core/ports/chat-model';
import type { ChatMessage } from '@core/domain/message';

function userMessage(content: string): ChatMessage {
  return { id: 'm1', role: 'user', content, createdAt: '2026-01-01T00:00:00Z' };
}

/** The JSON request body the fetch mock was called with. */
function sentBody(
  fetchMock: ReturnType<typeof vi.fn>
): Record<string, unknown> {
  const init = fetchMock.mock.calls.at(-1)?.[1] as { body?: string };
  return JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
}

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

  it('advertises mandatory reasoning for gpt-oss but not plain models', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        data: [{ id: 'gpt-oss:20b' }, { id: 'llama3.1:8b' }],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const models = await new OllamaProvider(
      'http://127.0.0.1:11434'
    ).listModels();

    expect(models.find((m) => m.id === 'gpt-oss:20b')?.reasoning).toEqual({
      effortLevels: [
        ReasoningEffort.Low,
        ReasoningEffort.Medium,
        ReasoningEffort.High,
      ],
      mandatory: true,
      defaultEffort: ReasoningEffort.Medium,
    });
    expect(
      models.find((m) => m.id === 'llama3.1:8b')?.reasoning
    ).toBeUndefined();
  });

  it('sends reasoning_effort for a chosen level', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createJsonResponse({ choices: [{ message: { content: 'hi' } }] })
      );
    vi.stubGlobal('fetch', fetchMock);

    await new OllamaProvider('http://127.0.0.1:11434').sendChat({
      model: 'gpt-oss:20b',
      messages: [userMessage('hello')],
      reasoningEffort: ReasoningEffort.High,
    });

    expect(sentBody(fetchMock).reasoning_effort).toBe('high');
  });

  it("sends reasoning_effort 'none' when the choice is off", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createJsonResponse({ choices: [{ message: { content: 'hi' } }] })
      );
    vi.stubGlobal('fetch', fetchMock);

    await new OllamaProvider('http://127.0.0.1:11434').sendChat({
      model: 'some-local-model',
      messages: [userMessage('hello')],
      reasoningEffort: 'off',
    });

    expect(sentBody(fetchMock).reasoning_effort).toBe('none');
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

  it('retries on /responses (keeping tools) when /chat/completions says to use the Responses API', async () => {
    // Copilot rejects function tools + reasoning_effort on /chat/completions for
    // some GPT-5 models and points to /responses. The model still supports tools,
    // so we must route there — not flag it tool-unsupported and drop tools.
    const sseBody = [
      'data: {"type":"response.output_text.delta","delta":"hi there"}',
      '',
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":5,"output_tokens":2}}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const fetchMock = vi.fn(async (url: string, _init?: { body?: string }) => {
      if (url.endsWith('/chat/completions')) {
        return new Response(
          JSON.stringify({
            error: {
              message:
                'Function tools with reasoning_effort are not supported for gpt-5.4 in /v1/chat/completions. Please use /v1/responses instead.',
              code: 'invalid_request_body',
            },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(sseBody, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAiCompatibleProvider({
      providerId: ProviderId.Copilot,
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'token',
    });

    const result = await provider.sendChat({
      model: 'gpt-5.4',
      messages: [userMessage('hey')],
      reasoningEffort: ReasoningEffort.Medium,
      tools: [
        {
          name: 'lazy_load_tools',
          description: 'load tools',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      ],
    });

    expect(result.content).toBe('hi there');
    const urls = fetchMock.mock.calls.map((call) => call[0] as string);
    expect(urls.some((url) => url.endsWith('/chat/completions'))).toBe(true);
    const responsesCall = fetchMock.mock.calls.find((call) =>
      (call[0] as string).endsWith('/responses')
    );
    expect(responsesCall).toBeDefined();
    const responsesBody = JSON.parse(responsesCall?.[1]?.body ?? '{}') as {
      tools?: unknown[];
    };
    expect(responsesBody.tools?.length).toBe(1);
  });

  it('writes request and response logs to debug.log', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'justcode-debug-'));
    const filePath = join(tempDir, 'debug.log');
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createJsonResponse({ data: [{ id: 'codellama:13b' }] })
      );

    vi.stubGlobal('fetch', fetchMock);

    try {
      await new OllamaProvider('http://127.0.0.1:11434').listModels();

      const contents = await readFile(filePath, 'utf8');
      expect(contents).toContain('"request"');
      expect(contents).toContain('"response"');
      expect(contents).toContain('/v1/models');
    } finally {
      cwdSpy.mockRestore();
    }
  });
});
