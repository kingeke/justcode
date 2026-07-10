import { describe, expect, it } from 'vitest';

import { SortDirection } from '@cli/shared/sort.js';

describe('SortDirection', () => {
  it('preserves the serialized string values', () => {
    expect(SortDirection.Asc).toBe('asc');
    expect(SortDirection.Desc).toBe('desc');
  });
});
