import { describe, expect, it } from 'vitest';

import { createMessage } from '@core/domain/message';
import { toOpenAiWireMessages } from './openai-wire.js';

describe('toOpenAiWireMessages with images', () => {
  it('builds multi-part content with a data-URI image_url part', () => {
    const message = createMessage(
      'user',
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
    const [wire] = toOpenAiWireMessages([createMessage('user', 'hello')]);
    expect(wire?.content).toBe('hello');
  });
});
