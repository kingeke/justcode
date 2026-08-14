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

  it('renders the question and option labels as Markdown', () => {
    const markup = renderToStaticMarkup(
      <InputPrompt
        request={{
          type: HostMessageType.UserInputRequest,
          id: 'q-3',
          question:
            'Use `amount_display`?\n\n- **default** `COST_TOTAL`\n- other',
          options: ['Go with `COST_TOTAL`', 'Plain option'],
        }}
        onRespond={() => {}}
      />
    );

    // Block Markdown in the question body: lists, emphasis, code spans.
    expect(markup).toContain('prompt-head markdown-body');
    expect(markup).toContain('<code>amount_display</code>');
    expect(markup).toContain('<strong>default</strong>');
    expect(markup).toContain('<ul>');
    expect(markup).not.toContain('`amount_display`');

    // Option labels render inline (no wrapping <p> to break the button row).
    expect(markup).toContain('<code>COST_TOTAL</code>');
    expect(markup).toContain(
      '<span class="prompt-option-label markdown-body">Plain option</span>'
    );
  });
});
