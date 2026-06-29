import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DiffView } from '@ext/webview/components/DiffView';

describe('DiffView', () => {
  it('renders changed lines with surrounding context and collapses distant unchanged regions', () => {
    const oldText = [
      'line 1',
      'line 2',
      'line 3',
      'line 4',
      'line 5',
      'line 6',
      'line 7',
      'line 8',
      'line 9',
      'line 10',
      'line 11',
      'line 12',
    ].join('\n');
    const newText = [
      'line 1',
      'line 2',
      'line 3',
      'line 4 updated',
      'line 5',
      'line 6',
      'line 7',
      'line 8',
      'line 9',
      'line 10',
      'line 11',
      'line 12 updated',
    ].join('\n');

    const markup = renderToStaticMarkup(
      <DiffView diff={{ path: 'README.md', oldText, newText }} />
    );

    expect(markup).toContain('diff-line diff-context');
    expect(markup).toContain('line 1');
    expect(markup).toContain('line 3');
    expect(markup).toContain('line 4 updated');
    expect(markup).toContain('line 12 updated');
    expect(markup).toContain('⋯ 1 unchanged line');
  });

  it('truncates very large rendered diffs', () => {
    const oldText = Array.from(
      { length: 60 },
      (_, index) => `old ${index + 1}`
    ).join('\n');
    const newText = Array.from(
      { length: 60 },
      (_, index) => `new ${index + 1}`
    ).join('\n');

    const markup = renderToStaticMarkup(
      <DiffView diff={{ path: 'big.txt', oldText, newText }} />
    );

    expect(markup).toContain('⋯ (80 more lines)');
  });
});
