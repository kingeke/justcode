import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { HostMessageType } from '@ext/shared/protocol';
import { InputPrompt } from '@ext/webview/components/Prompts';

describe('InputPrompt', () => {
  it('renders options as a numbered vertical list with the free-text input below', () => {
    const markup = renderToStaticMarkup(
      <InputPrompt
        request={{
          type: HostMessageType.UserInputRequest,
          id: 'q-1',
          question: 'Which database?',
          options: ['postgres', 'mysql', 'sqlite'],
        }}
        onRespond={() => {}}
      />
    );

    // A numbered list, one option per line.
    expect(markup).toContain('<ol class="prompt-options">');
    expect(markup).toContain('prompt-option-number');
    const numbers = [
      ...markup.matchAll(/prompt-option-number[^>]*>([^<]+)</g),
    ].map((m) => m[1]);
    expect(numbers).toEqual(['1.', '2.', '3.']);
    for (const option of ['postgres', 'mysql', 'sqlite']) {
      expect(markup).toContain(option);
    }
    // The custom-answer input stays available below the options.
    expect(markup).toContain('prompt-text');
    expect(markup).toContain('Type your answer…');
  });

  it('renders only the free-text input when the question has no options', () => {
    const markup = renderToStaticMarkup(
      <InputPrompt
        request={{
          type: HostMessageType.UserInputRequest,
          id: 'q-2',
          question: 'Name the branch:',
        }}
        onRespond={() => {}}
      />
    );

    expect(markup).not.toContain('prompt-options');
    expect(markup).toContain('prompt-text');
  });
});
