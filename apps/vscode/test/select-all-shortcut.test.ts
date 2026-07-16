import { describe, expect, it } from 'vitest';

import { isSelectAllShortcut, KeyboardKey } from '@ext/webview/platform';

function key(
  overrides: Partial<{
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
  }>
): { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean } {
  return {
    key: KeyboardKey.A,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...overrides,
  };
}

describe('isSelectAllShortcut', () => {
  it('matches Ctrl+A (Windows/Linux)', () => {
    expect(isSelectAllShortcut(key({ ctrlKey: true }))).toBe(true);
  });

  it('matches Cmd+A (macOS)', () => {
    expect(isSelectAllShortcut(key({ metaKey: true }))).toBe(true);
  });

  it('matches when the key reports uppercase A', () => {
    expect(isSelectAllShortcut(key({ key: 'A', ctrlKey: true }))).toBe(true);
  });

  it('ignores a plain "a" keypress while typing', () => {
    expect(isSelectAllShortcut(key({}))).toBe(false);
  });

  it('ignores other modified keys', () => {
    expect(
      isSelectAllShortcut(key({ key: KeyboardKey.Enter, ctrlKey: true }))
    ).toBe(false);
    expect(
      isSelectAllShortcut(key({ key: KeyboardKey.Escape, metaKey: true }))
    ).toBe(false);
  });

  it('ignores Alt-combined chords (e.g. AltGr input)', () => {
    expect(isSelectAllShortcut(key({ ctrlKey: true, altKey: true }))).toBe(
      false
    );
  });
});
