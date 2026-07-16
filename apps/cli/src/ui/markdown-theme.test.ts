import { describe, expect, it } from 'vitest';

import {
  MARKDOWN_MUTED_SYNTAX_STYLES,
  MARKDOWN_SYNTAX_STYLES,
} from '@cli/ui/markdown-theme.js';

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

  it('renders inline code as a chip but keeps fenced captures flat', () => {
    // The chip background is what makes inline code read like the extension's.
    expect(MARKDOWN_SYNTAX_STYLES['markup.raw']?.bg).toBeDefined();
    // Fence captures inside coalesced prose must not inherit the chip bg.
    expect(MARKDOWN_SYNTAX_STYLES['markup.raw.block']).toBeDefined();
    expect(MARKDOWN_SYNTAX_STYLES['markup.raw.block']?.bg).toBeUndefined();
  });

  it('styles headings and list markers neutrally (extension-style)', () => {
    // All heading levels share the bright neutral fg instead of accent blues.
    const headingFg = MARKDOWN_SYNTAX_STYLES['markup.heading']?.fg;
    expect(headingFg).toBe('#e6edf3');
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(MARKDOWN_SYNTAX_STYLES[`markup.heading.${level}`]?.fg).toBe(
        headingFg
      );
    }
    // Bullets are muted grey, not red.
    expect(MARKDOWN_SYNTAX_STYLES['markup.list']?.fg).toBe('#8b949e');
  });
});

describe('MARKDOWN_MUTED_SYNTAX_STYLES', () => {
  it('drops chip backgrounds so thinking renders flat', () => {
    for (const style of Object.values(MARKDOWN_MUTED_SYNTAX_STYLES)) {
      expect(style.bg).toBeUndefined();
    }
  });
});
