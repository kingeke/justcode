import { describe, expect, it } from 'vitest';
import { RGBA } from '@opentui/core';
import { ansiToStyledText } from '@cli/ui/ansi-to-styled-text';

describe('ansiToStyledText', () => {
  it('passes plain text through as a single chunk', () => {
    const styled = ansiToStyledText('hello world');
    expect(styled.chunks).toHaveLength(1);
    expect(styled.chunks[0]?.text).toBe('hello world');
    expect(styled.chunks[0]?.fg).toBeUndefined();
  });

  it('parses a standard foreground color', () => {
    const styled = ansiToStyledText('\x1b[31mred\x1b[0m');
    const colored = styled.chunks.find((c) => c.text === 'red');
    expect(colored).toBeDefined();
    expect(colored?.fg).toBeInstanceOf(RGBA);
  });

  it('resets styling after code 0', () => {
    const styled = ansiToStyledText('\x1b[1;32mon\x1b[0m off');
    const off = styled.chunks.find((c) => c.text === ' off');
    expect(off).toBeDefined();
    expect(off?.fg).toBeUndefined();
    expect(off?.attributes ?? 0).toBe(0);
  });

  it('parses truecolor (38;2;r;g;b)', () => {
    const styled = ansiToStyledText('\x1b[38;2;10;20;30mtc\x1b[0m');
    const tc = styled.chunks.find((c) => c.text === 'tc');
    expect(tc?.fg).toBeInstanceOf(RGBA);
  });

  it('parses 256-color (38;5;n)', () => {
    const styled = ansiToStyledText('\x1b[38;5;196mc256\x1b[0m');
    const c = styled.chunks.find((c) => c.text === 'c256');
    expect(c?.fg).toBeInstanceOf(RGBA);
  });

  it('applies bold attribute', () => {
    const styled = ansiToStyledText('\x1b[1mbold\x1b[22m plain');
    const bold = styled.chunks.find((c) => c.text === 'bold');
    const plain = styled.chunks.find((c) => c.text === ' plain');
    expect(bold?.attributes ?? 0).toBeGreaterThan(0);
    expect(plain?.attributes ?? 0).toBe(0);
  });

  it('strips non-SGR escape sequences (e.g. OSC hyperlinks)', () => {
    const styled = ansiToStyledText(
      '\x1b]8;;https://x.test\x07link\x1b]8;;\x07'
    );
    const joined = styled.chunks.map((c) => c.text).join('');
    expect(joined).toBe('link');
  });
});
