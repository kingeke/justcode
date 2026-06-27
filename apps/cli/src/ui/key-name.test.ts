import { describe, expect, it } from 'vitest';

import { isKeyName, isNonPrintableKey, KeyName } from '@cli/ui/key-name.js';

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

  describe('isNonPrintableKey', () => {
    it('treats named navigation/control keys as non-printable', () => {
      for (const name of ['up', 'down', 'return', 'escape', 'space', 'tab', 'backspace', 'f1']) {
        expect(isNonPrintableKey(name)).toBe(true);
      }
    });

    it('keeps single-character keys printable (letters, digits, symbols)', () => {
      // Digits and '-' collide with OpenTUI numpad key names; letters collide
      // with combo identifiers. All must remain typeable in a search box.
      for (const name of ['a', 'c', 'n', 'v', 'y', '1', '0', '9', '-', '/', '=']) {
        expect(isNonPrintableKey(name)).toBe(false);
      }
    });

    it('ignores undefined', () => {
      expect(isNonPrintableKey(undefined)).toBe(false);
    });
  });
});
