import { describe, expect, it } from 'vitest';

import { formatCost } from '@core/domain/format-cost';

describe('formatCost', () => {
  it('rounds to two decimals at or above one dollar', () => {
    expect(formatCost(3.5071)).toBe('3.51');
    expect(formatCost(1)).toBe('1.00');
    expect(formatCost(12.3456)).toBe('12.35');
  });

  it('keeps four decimals below one dollar so small costs stay visible', () => {
    expect(formatCost(0.5071)).toBe('0.5071');
    expect(formatCost(0.0003)).toBe('0.0003');
    expect(formatCost(0)).toBe('0.0000');
  });
});
