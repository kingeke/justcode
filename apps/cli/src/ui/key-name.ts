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

export function isKeyName(value: string | undefined): value is KeyName {
  return value !== undefined && KEY_NAME_SET.has(value);
}
