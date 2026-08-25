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
          questions: [
            {
              id: 'q1',
              question: 'Which database?',
              options: ['postgres', 'mysql', 'sqlite'],
            },
          ],
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
    // Nothing is chosen yet, so no option is marked (the mark appears once an
    // answer exists — e.g. after stepping back to the question).
    expect(markup).not.toContain('prompt-option-chosen');
    expect(markup).toContain('aria-pressed="false"');
    // The custom-answer input stays available below the options.
    expect(markup).toContain('prompt-text');
    expect(markup).toContain('Type your own answer…');
    // A lone question has no step counter.
    expect(markup).not.toContain('prompt-step');
  });

  it('renders only the free-text input when the question has no options', () => {
    const markup = renderToStaticMarkup(
      <InputPrompt
        request={{
          type: HostMessageType.UserInputRequest,
          id: 'q-2',
          questions: [{ id: 'q1', question: 'Name the branch:' }],
        }}
        onRespond={() => {}}
      />
    );

    expect(markup).not.toContain('prompt-options');
    expect(markup).toContain('prompt-text');
  });

  it('shows a step counter and the first question of a batch', () => {
    const markup = renderToStaticMarkup(
      <InputPrompt
        request={{
          type: HostMessageType.UserInputRequest,
          id: 'q-3',
          questions: [
            { id: 'q1', question: 'How many guests?', options: ['2', '4-6'] },
            { id: 'q2', question: 'Any allergies?' },
            { id: 'q3', question: 'Budget?' },
          ],
        }}
        onRespond={() => {}}
      />
    );

    expect(markup).toContain('Question 1 of 3');
    expect(markup).toContain('How many guests?');
    // Later questions only appear once the user steps to them, and nothing is
    // answered yet so no summary row shows.
    expect(markup).not.toContain('Any allergies?');
    expect(markup).not.toContain('prompt-answered');
    // Next/skip controls drive the flow.
    expect(markup).toContain('>Next</button>');
    expect(markup).toContain('>Skip</button>');
  });

  it('renders the question and option labels as Markdown', () => {
    const markup = renderToStaticMarkup(
      <InputPrompt
        request={{
          type: HostMessageType.UserInputRequest,
          id: 'q-4',
          questions: [
            {
              id: 'q1',
              question:
                'Use `amount_display`?\n\n- **default** `COST_TOTAL`\n- other',
              options: ['Go with `COST_TOTAL`', 'Plain option'],
            },
          ],
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
