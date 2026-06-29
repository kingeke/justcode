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
