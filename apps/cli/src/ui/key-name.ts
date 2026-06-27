import { terminalNamedSingleStrokeKeys, type KeyEvent } from '@opentui/core';

export enum KeyName {
  Return = 'return',
  Tab = 'tab',
  Escape = 'escape',
  Space = 'space',
  Up = 'up',
  Down = 'down',
  Right = 'right',
  Left = 'left',
  End = 'end',
  Home = 'home',
  Insert = 'insert',
  Delete = 'delete',
  PageUp = 'pageup',
  PageDown = 'pagedown',
  Backspace = 'backspace',
  C = 'c',
  V = 'v',
  Y = 'y',
  A = 'a',
  N = 'n',
}

const KEY_NAME_SET = new Set<string>([
  ...terminalNamedSingleStrokeKeys,
  ...Object.values(KeyName),
]);

export function isKeyName(value: string | undefined): value is KeyName {
  return value !== undefined && KEY_NAME_SET.has(value);
}

/**
 * True for named control/navigation keys that must never be inserted as text
 * (arrows, return, escape, f1, backspace, space, …).
 *
 * Such keys always have multi-character names. Printable keystrokes report
 * their single character as the name — including letters (whose names double as
 * combo identifiers like ctrl+c) and digits/symbols (whose names collide with
 * numpad entries such as "1" or "-" in OpenTUI's key map). So a single-character
 * name is always printable here; modifier combos are already filtered upstream
 * by the key.ctrl / key.meta check before this is consulted.
 */
export function isNonPrintableKey(value: string | undefined): boolean {
  return value !== undefined && value.length > 1 && KEY_NAME_SET.has(value);
}

/**
 * The literal character a keystroke should insert into a text field, or
 * undefined for control/navigation keys that must not produce text. Shared by
 * the picker search boxes so they all treat input identically.
 */
export function printableInput(key: KeyEvent): string | undefined {
  if (key.ctrl || key.meta) return undefined;
  // Space reports the multi-character name 'space' (so isNonPrintableKey would
  // reject it), but it's a literal character in search text.
  if (key.name === KeyName.Space) return ' ';
  if (isNonPrintableKey(key.name)) return undefined;
  const sequence = key.sequence;
  if (!sequence) return undefined;
  for (const char of sequence) {
    if (char < ' ' || char === '\x7f') return undefined;
  }
  return sequence;
}
