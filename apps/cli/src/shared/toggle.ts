/** On/off state rendered in the status line. */
export enum Toggle {
  On = 'on',
  Off = 'off',
}
/** Maps a boolean to its Toggle label. */
export function toggleLabel(value: boolean): Toggle {
  return value ? Toggle.On : Toggle.Off;
}

/** Named terminal colors used across the CLI UI (passed to @opentui). */
export enum UiColor {
  Green = 'green',
  Yellow = 'yellow',
  Red = 'red',
  Cyan = 'cyan',
  White = 'white',
  Magenta = 'magenta',
  Gray = 'gray',
  Black = 'black',
}

/** Green when on, yellow when off — the status-line toggle color convention. */
export function toggleColor(value: boolean): UiColor {
  return value ? UiColor.Green : UiColor.Yellow;
}
