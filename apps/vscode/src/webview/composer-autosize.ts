// Auto-grow sizing for the composer textarea.
//
// The textarea starts at MIN_ROWS and grows one line at a time as the user
// types, up to MAX_ROWS, after which it scrolls internally. Height is derived
// from the browser-measured scrollHeight so wrapped lines count too.

/** Font size of the composer input, in px (keep in sync with webview.css). */
export const COMPOSER_FONT_SIZE = 13;
/** Line-height multiplier of the composer input (keep in sync with webview.css). */
export const COMPOSER_LINE_HEIGHT = 1.4;
/** Rows the textarea shows when empty / with little text. */
export const COMPOSER_MIN_ROWS = 2;
/** Rows the textarea may grow to before it starts scrolling. */
export const COMPOSER_MAX_ROWS = 12;

/** Height, in px, of a single text row. */
export function rowHeight(): number {
  return COMPOSER_FONT_SIZE * COMPOSER_LINE_HEIGHT;
}

/** Largest height, in px, the textarea may grow to (MAX_ROWS tall). */
export function maxComposerHeight(): number {
  return rowHeight() * COMPOSER_MAX_ROWS;
}

/** Smallest height, in px, the textarea occupies (MIN_ROWS tall). */
export function minComposerHeight(): number {
  return rowHeight() * COMPOSER_MIN_ROWS;
}

/**
 * Clamp the browser-measured content height into the composer's allowed range.
 * `scrollHeight` is the full height the content wants; the result is what the
 * textarea should be set to (never below MIN_ROWS, never above MAX_ROWS).
 */
export function clampComposerHeight(scrollHeight: number): number {
  return Math.min(
    maxComposerHeight(),
    Math.max(minComposerHeight(), scrollHeight)
  );
}
