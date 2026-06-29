import { describe, expect, it } from 'vitest';

import {
  createMessage,
  renderMessageContentForModel,
} from '@core/domain/message';

describe('renderMessageContentForModel', () => {
  it('appends attached file contents to the model prompt', () => {
    expect(
      renderMessageContentForModel({
        id: 'message-1',
        role: 'user',
        content: 'Review these files',
        createdAt: '2026-06-22T00:00:00.000Z',
        attachments: [{ path: 'src/app.ts', content: 'console.log("hello")' }],
      })
    ).toContain('File: src/app.ts');
  });

  it('attaches images passed via extras', () => {
    const message = createMessage(
      'user',
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
    const message = createMessage('user', 'hi');
    expect(message.images).toBeUndefined();
  });

  it('can persist assistant thinking metadata', () => {
    const message = createMessage(
      'assistant',
      'partial',
      new Date(),
      undefined,
      {
        thinking: { content: 'thinking', durationMs: 42 },
      }
    );

    expect(message.thinking).toEqual({ content: 'thinking', durationMs: 42 });
  });
});
