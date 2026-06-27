import { terminalNamedSingleStrokeKeys } from '@opentui/core';

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

// These KeyName entries are ordinary printable letters that double as
// identifiers for modifier combos (e.g. ctrl+c, meta+v, ctrl+a). When typed on
// their own they must remain insertable as text, so they don't count as
// non-printable keys. The combos still work: they're matched against the enum
// constants directly and are already gated on key.ctrl/key.meta.
const PRINTABLE_KEY_NAMES = new Set<string>([
  KeyName.A,
  KeyName.C,
  KeyName.N,
  KeyName.V,
  KeyName.Y,
]);

export function isKeyName(value: string | undefined): value is KeyName {
  return value !== undefined && KEY_NAME_SET.has(value);
}

/**
 * True for named control/navigation keys that must never be inserted as text
 * (arrows, return, escape, …). Unlike {@link isKeyName}, this excludes the
 * printable letter aliases so a search box can still accept a/c/n/v/y.
 */
export function isNonPrintableKey(value: string | undefined): boolean {
  return (
    value !== undefined &&
    KEY_NAME_SET.has(value) &&
    !PRINTABLE_KEY_NAMES.has(value)
  );
}
