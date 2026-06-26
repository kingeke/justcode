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

  it('collapses unchanged lines far from the change into a hunk', () => {
    const before = Array.from({ length: 50 }, (_, i) => `line ${i}`);
    const after = [...before];
    after[25] = 'CHANGED';
    const out = plain(
      renderDiff({
        path: 'a.txt',
        oldText: before.join('\n'),
        newText: after.join('\n'),
      })
    );
    const lines = out.split('\n');

    // The change and a little context are shown...
    expect(lines).toContain('- line 25');
    expect(lines).toContain('+ CHANGED');
    expect(lines).toContain('  line 24');
    expect(lines).toContain('  line 22'); // 3 lines of context
    // ...but distant unchanged lines are collapsed, not dumped.
    expect(lines).not.toContain('  line 0');
    expect(lines).not.toContain('  line 49');
    expect(out).toMatch(/⋯ \d+ unchanged lines/);
    // The whole hunk stays compact.
    expect(lines.length).toBeLessThan(15);
  });
});
