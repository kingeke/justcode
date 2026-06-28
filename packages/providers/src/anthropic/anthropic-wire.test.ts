import { describe, expect, it } from 'vitest';

import { createMessage } from '@core/domain/message';
import { toAnthropicWireRequest } from './anthropic-wire.js';

describe('toAnthropicWireRequest with images', () => {
  it('emits an image block before the text block', () => {
    const message = createMessage(
      'user',
      'what is this?',
      new Date(),
      undefined,
      { images: [{ mediaType: 'image/png', data: 'BASE64' }] }
    );

    const { messages } = toAnthropicWireRequest([message]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toEqual([
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'BASE64' },
      },
      { type: 'text', text: 'what is this?' },
    ]);
  });

  it('omits the text block for an image-only message', () => {
    const message = createMessage('user', '', new Date(), undefined, {
      images: [{ mediaType: 'image/png', data: 'BASE64' }],
    });

    const { messages } = toAnthropicWireRequest([message]);

    expect(messages[0]?.content).toEqual([
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'BASE64' },
      },
    ]);
  });
});
