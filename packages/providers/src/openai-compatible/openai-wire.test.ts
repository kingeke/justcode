import { describe, expect, it } from 'vitest';

import { createMessage, MessageRole } from '@core/domain/message';
import {
  parseOpenAiToolCalls,
  sanitizeToolCallName,
  toOpenAiWireMessages,
} from './openai-wire.js';

describe('toOpenAiWireMessages with images', () => {
  it('builds multi-part content with a data-URI image_url part', () => {
    const message = createMessage(
      MessageRole.User,
      'describe this',
      new Date(),
      undefined,
      { images: [{ mediaType: 'image/png', data: 'BASE64' }] }
    );

    const [wire] = toOpenAiWireMessages([message]);

    expect(wire?.content).toEqual([
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,BASE64' },
      },
      { type: 'text', text: 'describe this' },
    ]);
  });

  it('keeps the plain string form when there are no images', () => {
    const [wire] = toOpenAiWireMessages([
      createMessage(MessageRole.User, 'hello'),
    ]);
    expect(wire?.content).toBe('hello');
  });
});

describe('sanitizeToolCallName', () => {
  it('strips harmony channel suffixes and functions. prefixes gpt-oss leaks', () => {
    // Observed on the wire from gpt-oss via OpenRouter: the upstream server
    // doesn't fully parse the harmony format out of the function name.
    expect(sanitizeToolCallName('glob<|channel|>commentary')).toBe('glob');
    expect(sanitizeToolCallName('functions.glob')).toBe('glob');
    expect(sanitizeToolCallName('functions.glob<|channel|>commentary')).toBe(
      'glob'
    );
    expect(sanitizeToolCallName('glob')).toBe('glob');
  });

  it('is applied when parsing non-streaming tool calls', () => {
    const calls = parseOpenAiToolCalls([
      {
        id: 'call-1',
        function: {
          name: 'bash<|channel|>commentary',
          arguments: '{"command":"ls"}',
        },
      },
    ]);

    expect(calls).toEqual([
      { id: 'call-1', name: 'bash', arguments: '{"command":"ls"}' },
    ]);
  });
});
