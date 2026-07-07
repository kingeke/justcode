import { describe, expect, it } from 'vitest';

import {
  createMessage,
  markLlmReceived,
  MessageRole,
  renderMessageContentForModel,
} from '@core/domain/message';

describe('renderMessageContentForModel', () => {
  it('appends attached file contents to the model prompt', () => {
    expect(
      renderMessageContentForModel({
        id: 'message-1',
        role: MessageRole.User,
        content: 'Review these files',
        createdAt: '2026-06-22T00:00:00.000Z',
        attachments: [{ path: 'src/app.ts', content: 'console.log("hello")' }],
      })
    ).toContain('File: src/app.ts');
  });

  it('attaches images passed via extras', () => {
    const message = createMessage(
      MessageRole.User,
      'look at this',
      new Date(),
      undefined,
      {
        images: [{ mediaType: 'image/png', data: 'AAAA' }],
      }
    );

    expect(message.images).toEqual([{ mediaType: 'image/png', data: 'AAAA' }]);
  });

  it('omits the images field when none are provided', () => {
    const message = createMessage(MessageRole.User, 'hi');
    expect(message.images).toBeUndefined();
  });

  it('can persist assistant thinking metadata', () => {
    const message = createMessage(
      MessageRole.Assistant,
      'partial',
      new Date(),
      undefined,
      {
        thinking: { content: 'thinking', durationMs: 42 },
      }
    );

    expect(message.thinking).toEqual({ content: 'thinking', durationMs: 42 });
  });

  it('carries the LLM-received time passed via extras', () => {
    const message = createMessage(
      MessageRole.Assistant,
      'hi',
      new Date(),
      undefined,
      {
        llmReceivedAt: '2026-07-02T10:00:05.000Z',
      }
    );

    expect(message.llmReceivedAt).toBe('2026-07-02T10:00:05.000Z');
  });

  it('carries the compact-summary flag passed via extras', () => {
    const flagged = createMessage(
      MessageRole.User,
      'summary',
      new Date(),
      undefined,
      {
        isCompactSummary: true,
      }
    );
    expect(flagged.isCompactSummary).toBe(true);

    const plain = createMessage(MessageRole.User, 'hello');
    expect(plain.isCompactSummary).toBeUndefined();
  });
});

describe('markLlmReceived', () => {
  it('stamps unstamped user messages with the received time', () => {
    const user = createMessage(MessageRole.User, 'hello');
    const assistant = createMessage(MessageRole.Assistant, 'hi');
    const receivedAt = new Date('2026-07-02T10:00:05.000Z');

    markLlmReceived([user, assistant], receivedAt);

    expect(user.llmReceivedAt).toBe('2026-07-02T10:00:05.000Z');
    expect(assistant.llmReceivedAt).toBeUndefined();
  });

  it('leaves already-stamped user messages untouched', () => {
    const user = createMessage(MessageRole.User, 'hello');
    user.llmReceivedAt = '2026-07-02T09:00:00.000Z';

    markLlmReceived([user], new Date('2026-07-02T10:00:05.000Z'));

    expect(user.llmReceivedAt).toBe('2026-07-02T09:00:00.000Z');
  });
});
