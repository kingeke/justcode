import { describe, expect, it } from 'vitest';

import { createMessage } from '@core/domain/message';
import { toResponsesPayload } from './openai-responses-wire.js';

describe('toResponsesPayload with images', () => {
  it('emits an input_image part before the input_text part', () => {
    const message = createMessage(
      'user',
      'what is this?',
      new Date(),
      undefined,
      { images: [{ mediaType: 'image/png', data: 'BASE64' }] }
    );

    const { input } = toResponsesPayload([message]);

    expect(input[0]?.content).toEqual([
      { type: 'input_image', image_url: 'data:image/png;base64,BASE64' },
      { type: 'input_text', text: 'what is this?' },
    ]);
  });
});
