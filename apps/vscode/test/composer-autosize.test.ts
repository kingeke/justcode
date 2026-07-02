import { describe, expect, it } from 'vitest';

import {
  clampComposerHeight,
  COMPOSER_MAX_ROWS,
  COMPOSER_MIN_ROWS,
  maxComposerHeight,
  minComposerHeight,
  rowHeight,
} from '@ext/webview/composer-autosize';

describe('composer autosize', () => {
  it('never shrinks below MIN_ROWS', () => {
    expect(clampComposerHeight(0)).toBe(minComposerHeight());
    expect(clampComposerHeight(minComposerHeight() - 5)).toBe(
      minComposerHeight()
    );
  });

  it('grows with content between the min and max', () => {
    const fiveRows = rowHeight() * 5;
    expect(clampComposerHeight(fiveRows)).toBe(fiveRows);
  });

  it('caps growth at MAX_ROWS (12)', () => {
    const huge = rowHeight() * 100;
    expect(clampComposerHeight(huge)).toBe(maxComposerHeight());
  });

  it('exposes the 2-row minimum and 12-row maximum', () => {
    expect(COMPOSER_MIN_ROWS).toBe(2);
    expect(COMPOSER_MAX_ROWS).toBe(12);
    expect(maxComposerHeight()).toBe(rowHeight() * 12);
  });
});
