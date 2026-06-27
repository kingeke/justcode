import { describe, expect, it } from 'vitest';

import { isKeyName, KeyName } from '@cli/ui/key-name.js';

describe('key-name', () => {
  it('accepts supported enum values', () => {
    expect(isKeyName(KeyName.Return)).toBe(true);
    expect(isKeyName(KeyName.Up)).toBe(true);
    expect(isKeyName(KeyName.C)).toBe(true);
  });

  it('accepts named OpenTUI keys outside the local enum', () => {
    expect(isKeyName('f1')).toBe(true);
    expect(isKeyName('kpenter')).toBe(true);
  });

  it('rejects unknown key names', () => {
    expect(isKeyName(undefined)).toBe(false);
    expect(isKeyName('not-a-key')).toBe(false);
  });
});
