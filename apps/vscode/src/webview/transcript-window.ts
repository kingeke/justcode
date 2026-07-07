import type { WebviewMessage } from '@ext/shared/protocol';

/** Committed messages mounted by default; older ones hide behind "show earlier". */
export const MESSAGE_WINDOW = 200;

export interface TranscriptWindow {
  /** Messages the transcript should mount (the newest `limit`, or all). */
  visible: WebviewMessage[];
  /** How many older messages are hidden behind the "show earlier" button. */
  hiddenCount: number;
}

/**
 * Windows a long committed transcript so only the newest `limit` messages
 * mount — rendering (and re-rendering, once per streamed token) a thousand
 * messages is what makes big sessions feel slow. `showAll` (the "show earlier"
 * button / a sidebar jump into hidden history) disables the window.
 */
export function windowMessages(
  messages: WebviewMessage[],
  showAll: boolean,
  limit = MESSAGE_WINDOW
): TranscriptWindow {
  const hiddenCount = showAll ? 0 : Math.max(0, messages.length - limit);
  return {
    visible: hiddenCount > 0 ? messages.slice(hiddenCount) : messages,
    hiddenCount,
  };
}
