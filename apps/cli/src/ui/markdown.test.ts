import { describe, expect, it } from 'vitest';

import {
  closeUnbalancedCodeFences,
  prepareMarkdown,
  stripEnclosingMarkdownFence,
} from '@cli/ui/markdown.js';

describe('closeUnbalancedCodeFences', () => {
  it('leaves balanced content untouched', () => {
    const content = '### Title\n\n```ts\nconst a = 1;\n```\n\nDone.';
    expect(closeUnbalancedCodeFences(content)).toBe(content);
  });

  it('leaves prose without any fences untouched', () => {
    const content = '### Title\n\n**bold** and a list\n1. one\n2. two';
    expect(closeUnbalancedCodeFences(content)).toBe(content);
  });

  it('closes an unterminated fence so trailing prose can parse', () => {
    const content = '```sql\nSELECT 1\n\n### Key things to note\n1. **CTEs**';
    expect(closeUnbalancedCodeFences(content)).toBe(`${content}\n\`\`\``);
  });

  it('matches the opening fence length and char when closing', () => {
    const content = '~~~~\ncode with ``` inside\nmore';
    expect(closeUnbalancedCodeFences(content)).toBe(`${content}\n~~~~`);
  });

  it('does not add a newline when content already ends with one', () => {
    const content = '```\nopen\n';
    expect(closeUnbalancedCodeFences(content)).toBe('```\nopen\n```');
  });

  it('treats a fence with an info string as opening, not closing', () => {
    // The second ```ts must not be read as a close; the block stays open and
    // gets one appended.
    const content = '```\nfirst\n```ts\nsecond';
    expect(closeUnbalancedCodeFences(content)).toBe(`${content}\n\`\`\``);
  });
});

describe('stripEnclosingMarkdownFence', () => {
  it('unwraps a whole-message ```markdown fence', () => {
    const content = '```markdown\n### Title\n\n**bold**\n```';
    expect(stripEnclosingMarkdownFence(content)).toBe('### Title\n\n**bold**');
  });

  it('unwraps an unlabelled fence that clearly contains markdown', () => {
    const content = '```\n### Title\n\ntext\n```';
    expect(stripEnclosingMarkdownFence(content)).toBe('### Title\n\ntext');
  });

  it('keeps a longer outer fence around a shorter inner code block', () => {
    const content = '````markdown\n### Title\n\n```sql\nSELECT 1\n```\n````';
    expect(stripEnclosingMarkdownFence(content)).toBe(
      '### Title\n\n```sql\nSELECT 1\n```'
    );
  });

  it('does not unwrap ambiguous same-length nested fences', () => {
    const content = '```markdown\n```sql\nSELECT 1\n```\n```';
    expect(stripEnclosingMarkdownFence(content)).toBe(content);
  });

  it('does not unwrap a genuine code block (e.g. ```ts)', () => {
    const content = '```ts\nconst a = 1;\n```';
    expect(stripEnclosingMarkdownFence(content)).toBe(content);
  });

  it('does not unwrap an unlabelled fence that is just code', () => {
    const content = '```\nconst a = 1;\nreturn a;\n```';
    expect(stripEnclosingMarkdownFence(content)).toBe(content);
  });
});

describe('prepareMarkdown', () => {
  it('unwraps then closes so wrapped answers render', () => {
    const content = '```markdown\n### Title\n\n**bold**\n```';
    expect(prepareMarkdown(content)).toBe('### Title\n\n**bold**');
  });

  it('closes an unterminated fence in normal content', () => {
    const content = '### Title\n\n```sql\nSELECT 1';
    expect(prepareMarkdown(content)).toBe(`${content}\n\`\`\``);
  });
});
