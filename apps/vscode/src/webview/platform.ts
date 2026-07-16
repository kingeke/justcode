/** Label for the open-file modifier key, matched to the user's platform. */
export const MODIFIER_LABEL =
  typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)
    ? '⌘'
    : 'Ctrl';

/** Whether a mouse event carries the open-file modifier (Cmd on macOS, Ctrl elsewhere). */
export function hasOpenModifier(event: {
  metaKey: boolean;
  ctrlKey: boolean;
}): boolean {
  return event.metaKey || event.ctrlKey;
}

/** DOM `KeyboardEvent.key` values the webview compares against. */
export enum KeyboardKey {
  Enter = 'Enter',
  Escape = 'Escape',
  A = 'a',
}

/**
 * Whether a keyboard event is the select-all shortcut (Cmd+A on macOS,
 * Ctrl+A elsewhere). VS Code's workbench swallows the keybinding before the
 * webview input's native select-all runs, so inputs must handle it manually.
 */
export function isSelectAllShortcut(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    event.key.toLowerCase() === KeyboardKey.A
  );
}
