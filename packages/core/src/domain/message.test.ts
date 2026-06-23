import { describe, expect, it } from 'vitest';

import { createMessage, renderMessageContentForModel } from '@core/domain/message';

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

  it('can persist assistant thinking metadata', () => {
    const message = createMessage('assistant', 'partial', new Date(), undefined, {
      thinking: { content: 'thinking', durationMs: 42 },
    });

    expect(message.thinking).toEqual({ content: 'thinking', durationMs: 42 });
  });
});
