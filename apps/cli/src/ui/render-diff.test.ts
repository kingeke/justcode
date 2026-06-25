import { renderDiff } from '@cli/ui/render-diff';
import { describe, expect, it } from 'vitest';

// Strip ANSI color codes so assertions test structure, not exact escape codes.
// (chalk also disables color entirely when stdout is not a TTY, e.g. in CI.)
// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*m/g;
const plain = (text: string): string => text.replace(ANSI, '');

describe('renderDiff', () => {
  it('marks added lines with + and removed lines with -', () => {
    const out = plain(
      renderDiff({ path: 'a.txt', oldText: 'one\ntwo\n', newText: 'one\n2\n' })
    );
    const lines = out.split('\n');

    expect(lines).toContain('  one'); // unchanged context
    expect(lines).toContain('- two'); // removed
    expect(lines).toContain('+ 2'); // added
  });

  it('renders a creation (empty oldText) as all additions', () => {
    const out = plain(
      renderDiff({ path: 'a.txt', oldText: '', newText: 'a\nb' })
    );
    expect(out.split('\n').every((line) => line.startsWith('+ '))).toBe(true);
  });

  it('truncates very large diffs', () => {
    const newText = Array.from({ length: 100 }, (_, i) => `line ${i}`).join(
      '\n'
    );
    const out = plain(renderDiff({ path: 'a.txt', oldText: '', newText }));
    expect(out).toContain('more lines)');
  });
});
