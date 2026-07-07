import { describe, expect, it } from 'vitest';

import { renderMarkdown } from '@ext/webview/markdown';

describe('renderMarkdown cache', () => {
  it('renders markdown and returns the identical string on a repeat call', () => {
    const first = renderMarkdown('**bold** and `code`');
    expect(first).toContain('<strong>bold</strong>');
    expect(first).toContain('<code>code</code>');
    // Cache hit: the exact same string instance, no re-parse.
    expect(renderMarkdown('**bold** and `code`')).toBe(first);
  });

  it('keeps distinct inputs distinct', () => {
    expect(renderMarkdown('# one')).toContain('<h1');
    expect(renderMarkdown('## two')).toContain('<h2');
  });
});
