import { describe, expect, it, vi } from 'vitest';

import type { ChatRequest } from '@core/ports/chat-model';

import { consumeResponsesStream } from './openai-responses-client.js';

/** Builds an SSE ReadableStream from a list of Responses API events. */
function sseStream(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
}

function baseRequest(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return { model: 'gpt-5', messages: [], ...overrides } as ChatRequest;
}

describe('consumeResponsesStream reasoning vs content', () => {
  it('keeps reasoning as thinking (not content) on a tool-call step', async () => {
    const onThinkingToken = vi.fn();
    const onToken = vi.fn();
    const stream = sseStream([
      {
        type: 'response.reasoning_summary_text.delta',
        delta: '**Assessing tool usage**\n\nI might need tools here.',
      },
      {
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          name: 'glob',
          arguments: '{"pattern":"**/*"}',
          call_id: 'call-1',
        },
      },
    ]);

    const { result, reasoning } = await consumeResponsesStream(
      stream,
      baseRequest({ onThinkingToken, onToken }),
      'copilot'
    );

    // Reasoning streamed on the thinking channel...
    expect(onThinkingToken).toHaveBeenCalled();
    expect(onToken).not.toHaveBeenCalled();
    // ...and must NOT be promoted into the answer content.
    expect(result.content).toBe('');
    expect(result.toolCalls).toHaveLength(1);
    // ...and the model's reasoning output is captured for logging.
    expect(reasoning).toContain('I might need tools here.');
  });

  it('still surfaces reasoning as the answer when there is no output text and no tools (gpt-oss)', async () => {
    const stream = sseStream([
      {
        type: 'response.reasoning_summary_text.delta',
        delta: 'the whole answer lives on the reasoning channel',
      },
    ]);

    const { result } = await consumeResponsesStream(
      stream,
      baseRequest(),
      'oss'
    );

    expect(result.content).toBe(
      'the whole answer lives on the reasoning channel'
    );
    expect(result.toolCalls).toBeUndefined();
  });

  it('uses real output text as content when present', async () => {
    const stream = sseStream([
      { type: 'response.reasoning_summary_text.delta', delta: 'thinking...' },
      { type: 'response.output_text.delta', delta: 'Here are the files.' },
    ]);

    const { result } = await consumeResponsesStream(
      stream,
      baseRequest(),
      'oss'
    );

    expect(result.content).toBe('Here are the files.');
  });
});
