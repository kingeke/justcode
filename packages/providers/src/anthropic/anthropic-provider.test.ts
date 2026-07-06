import { describe, expect, it, vi } from 'vitest';

import {
  AnthropicProvider,
  AnthropicStreamAccumulator,
} from './anthropic-provider.js';
import { ReasoningEffort } from '@core/ports/chat-model';

describe('AnthropicStreamAccumulator usage math', () => {
  it('folds the cached prefix into inputTokens so ctx reflects full context', () => {
    const accumulator = new AnthropicStreamAccumulator();

    // Anthropic reports only the *uncached* prompt in `input_tokens`; the cached
    // prefix and any cache-creation tokens are broken out separately.
    accumulator.handle({
      type: 'message_start',
      message: {
        usage: {
          input_tokens: 2,
          cache_read_input_tokens: 1360,
          cache_creation_input_tokens: 5,
        },
      },
    });
    accumulator.handle({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'hello' },
    });
    accumulator.handle({
      type: 'message_delta',
      usage: { output_tokens: 39 },
    });

    const result = accumulator.toResult();

    // inputTokens is the total context (2 + 1360 + 5), not the 2-token delta.
    expect(result.usage).toEqual({
      inputTokens: 1367,
      outputTokens: 39,
      cachedTokens: 1360,
    });
  });

  it('treats missing cache fields as zero', () => {
    const accumulator = new AnthropicStreamAccumulator();

    accumulator.handle({
      type: 'message_start',
      message: { usage: { input_tokens: 100 } },
    });
    accumulator.handle({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'hi' },
    });
    accumulator.handle({
      type: 'message_delta',
      usage: { output_tokens: 7 },
    });

    expect(accumulator.toResult().usage).toEqual({
      inputTokens: 100,
      outputTokens: 7,
      cachedTokens: 0,
    });
  });
});

describe('anthropic thinking wire format', () => {
  it('uses adaptive thinking + output_config.effort on models that reject budgets', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'ok' }],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      });

    const provider = new AnthropicProvider({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'test',
    });
    const messages = [
      {
        id: '1',
        role: 'user' as const,
        content: 'hey',
        createdAt: new Date().toISOString(),
      },
    ];

    // Fable 5 rejects `enabled`/`budget_tokens` with a 400 — adaptive only.
    await provider.sendChat({
      model: 'claude-fable-5',
      messages,
      reasoningEffort: ReasoningEffort.Low,
    });
    expect(bodies[0]?.thinking).toEqual({ type: 'adaptive' });
    expect(bodies[0]?.output_config).toEqual({ effort: 'low' });

    // Older thinking models keep the token-budget form.
    await provider.sendChat({
      model: 'claude-sonnet-4-5',
      messages,
      reasoningEffort: ReasoningEffort.Low,
    });
    expect(bodies[1]?.thinking).toEqual({
      type: 'enabled',
      budget_tokens: 4096,
    });
    expect(bodies[1]?.output_config).toBeUndefined();

    fetchMock.mockRestore();
  });
});
