import { describe, expect, it } from 'vitest';

import { MARKDOWN_SYNTAX_STYLES } from '@cli/ui/markdown-theme.js';

describe('MARKDOWN_SYNTAX_STYLES', () => {
  it('registers the prose markup styles the renderer looks up', () => {
    // Without these the markdown chunks resolve to nothing and render raw.
    for (const name of [
      'default',
      'markup',
      'markup.heading',
      'markup.strong',
      'markup.italic',
      'markup.raw',
      'markup.list',
      'markup.link',
    ]) {
      expect(MARKDOWN_SYNTAX_STYLES[name]).toBeDefined();
    }
  });

  it('makes bold/heading actually bold', () => {
    expect(MARKDOWN_SYNTAX_STYLES['markup.strong']?.bold).toBe(true);
    expect(MARKDOWN_SYNTAX_STYLES['markup.heading']?.bold).toBe(true);
  });

  it('includes common code captures so fenced code blocks colorize', () => {
    for (const name of ['keyword', 'string', 'comment', 'function', 'type']) {
      expect(MARKDOWN_SYNTAX_STYLES[name]).toBeDefined();
    }
  });
});
