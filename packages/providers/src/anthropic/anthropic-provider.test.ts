import { describe, expect, it } from 'vitest';

import { AnthropicStreamAccumulator } from './anthropic-provider.js';

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
