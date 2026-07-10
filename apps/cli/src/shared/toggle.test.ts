import { describe, expect, it } from 'vitest';

import {
  Toggle,
  toggleColor,
  toggleLabel,
  UiColor,
} from '@cli/shared/toggle.js';

describe('toggleLabel', () => {
  it('maps true to Toggle.On', () => {
    expect(toggleLabel(true)).toBe(Toggle.On);
  });

  it('maps false to Toggle.Off', () => {
    expect(toggleLabel(false)).toBe(Toggle.Off);
  });
});

describe('toggleColor', () => {
  it('maps true to UiColor.Green', () => {
    expect(toggleColor(true)).toBe(UiColor.Green);
  });

  it('maps false to UiColor.Yellow', () => {
    expect(toggleColor(false)).toBe(UiColor.Yellow);
  });
});
