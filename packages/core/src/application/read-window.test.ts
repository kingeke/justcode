import { describe, expect, it } from 'vitest';

import {
  MAX_LINE_LENGTH,
  formatNumberedLine,
  splitLines,
} from '@core/application/read-window';

describe('splitLines', () => {
  it('returns no lines for an empty string', () => {
    expect(splitLines('')).toEqual([]);
  });

  it('splits on LF, CRLF, and lone CR', () => {
    expect(splitLines('a\nb\r\nc\rd')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not add a phantom line for a single trailing newline', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
  });

  it('keeps an intentional blank line', () => {
    expect(splitLines('a\n\nb')).toEqual(['a', '', 'b']);
  });
});

describe('formatNumberedLine', () => {
  it('prefixes the line number with a pipe separator', () => {
    expect(formatNumberedLine(7, 'hello')).toBe('7 | hello');
  });

  it('truncates a line longer than the limit and flags it', () => {
    const line = 'x'.repeat(MAX_LINE_LENGTH + 50);
    const formatted = formatNumberedLine(1, line);

    expect(formatted).toContain(
      `line truncated: ${MAX_LINE_LENGTH + 50} chars`
    );
    expect(formatted).toContain(`showing first ${MAX_LINE_LENGTH}`);
    expect(formatted).not.toContain('x'.repeat(MAX_LINE_LENGTH + 1));
  });
});
