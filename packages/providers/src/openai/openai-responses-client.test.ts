import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendResponsesRequest } from '@providers/openai/openai-responses-client';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('sendResponsesRequest', () => {
  it('enables parallel tool calls so multi-task batches run concurrently', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedBody = JSON.parse((init as RequestInit).body as string) as Record<
        string,
        unknown
      >;
      // A failing response is enough — the request body is built (and
      // captured) before the stream would be consumed.
      return new Response('boom', { status: 500 });
    }) as typeof fetch;

    await expect(
      sendResponsesRequest({
        baseUrl: 'https://example.test',
        headers: { 'content-type': 'application/json' },
        providerId: 'copilot',
        request: {
          model: 'gpt-test',
          messages: [
            {
              id: 'u1',
              role: 'user',
              content: 'hi',
              createdAt: new Date().toISOString(),
            },
          ],
          tools: [
            {
              name: 'task',
              description: 'delegate',
              parameters: { type: 'object' },
            },
          ],
        },
      })
    ).rejects.toThrow();

    // `false` here forced the model to emit one tool call per response,
    // serializing sub agents; the engine handles multi-call batches itself.
    expect(capturedBody?.parallel_tool_calls).toBe(true);
    expect(capturedBody?.tool_choice).toBe('auto');
  });
});
