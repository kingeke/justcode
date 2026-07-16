/**
 * Whether a user message bubble may hug the right edge (its natural look) or
 * must stretch to the full row width so its text wraps.
 *
 * OpenTUI only wraps text when the renderable resolves to a definite width
 * (e.g. a stretched flex child). A `flex-end`-aligned child is measured at its
 * intrinsic width instead, so a line longer than the transcript overflows to
 * the left and gets clipped — the start of the message disappears. Hug right
 * only when every line of the message already fits without wrapping.
 */

// Columns of chrome around the bubble's text: root padding, scrollbar, the
// row's right padding, and the bubble's border + padding — plus a safety
// margin for wide glyphs and concealed markdown markers.
const USER_BUBBLE_CHROME_COLS = 10;

export function userBubbleHugsRight(
  content: string,
  terminalWidth: number
): boolean {
  const available = terminalWidth - USER_BUBBLE_CHROME_COLS;
  if (available <= 0) return false;
  return content.split('\n').every((line) => line.length <= available);
}
