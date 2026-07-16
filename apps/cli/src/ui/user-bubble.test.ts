import { describe, expect, it } from 'vitest';

import { userBubbleHugsRight } from '@cli/ui/user-bubble.js';

describe('userBubbleHugsRight', () => {
  it('hugs right when every line fits within the transcript', () => {
    expect(userBubbleHugsRight('short message', 80)).toBe(true);
    expect(userBubbleHugsRight('one\ntwo\nthree', 80)).toBe(true);
  });

  it('stretches when a line would overflow (so it wraps, not clips)', () => {
    const long =
      'pes when no one is selected, similar to how the All Projects work ' +
      'among others as we do not want to modify for all, just this';
    expect(userBubbleHugsRight(long, 80)).toBe(false);
  });

  it('accounts for the chrome around the bubble, not the raw width', () => {
    // 75 chars in an 80-col terminal: fits the screen but not the bubble once
    // padding, border, and scrollbar are subtracted.
    expect(userBubbleHugsRight('x'.repeat(75), 80)).toBe(false);
    expect(userBubbleHugsRight('x'.repeat(70), 80)).toBe(true);
  });

  it('checks each line independently in multi-line messages', () => {
    const mixed = `short\n${'y'.repeat(120)}\nshort`;
    expect(userBubbleHugsRight(mixed, 80)).toBe(false);
  });

  it('stretches on degenerate terminal widths instead of clipping', () => {
    expect(userBubbleHugsRight('hi', 8)).toBe(false);
  });
});
