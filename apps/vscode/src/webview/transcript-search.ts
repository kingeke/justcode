import { WebviewRole, type WebviewMessage } from '@ext/shared/protocol';

/** Which way {@link stepMatchIndex} moves through the match list. */
export enum SearchDirection {
  Next = 'next',
  Previous = 'previous',
}

/** A committed message that contains the search query. */
export interface TranscriptMatch {
  /** Id of the matching message, so the transcript can scroll to `msg-<id>`. */
  messageId: string;
  /** How many times the query occurs in that message. */
  count: number;
}

/**
 * Whether a message is part of the conversation the find bar searches. Tool
 * messages are excluded: their content is command input and raw output (file
 * dumps, grep results, diffs), which swamps the results with hits on text the
 * user wasn't looking for. Compaction summaries are context, not conversation,
 * so they're out too.
 */
export function isSearchableMessage(message: WebviewMessage): boolean {
  return message.role !== WebviewRole.Tool && !message.isCompactSummary;
}

/**
 * Finds the committed messages containing `query`, in transcript order. Search
 * is case-insensitive and runs over the raw message text (the Markdown source)
 * of the conversation itself — tool input/output is skipped, see
 * {@link isSearchableMessage}. Pure, so it can be unit-tested without a DOM. A
 * blank query matches nothing.
 */
export function findTranscriptMatches(
  messages: WebviewMessage[],
  query: string
): TranscriptMatch[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];
  const matches: TranscriptMatch[] = [];
  for (const message of messages) {
    if (!isSearchableMessage(message)) continue;
    const haystack = message.content.toLowerCase();
    let count = 0;
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      count += 1;
      from = at + needle.length;
    }
    if (count > 0) matches.push({ messageId: message.id, count });
  }
  return matches;
}

/**
 * Total occurrences across every matching message — the "N results" the find
 * bar reports, as opposed to `matches.length` (matching messages).
 */
export function countTranscriptMatches(matches: TranscriptMatch[]): number {
  return matches.reduce((sum, match) => sum + match.count, 0);
}

/**
 * The message holding the `index`-th occurrence (counting every occurrence, not
 * just matching messages), or undefined when the index is out of range. Lets the
 * find bar step occurrence by occurrence while the transcript scrolls per message.
 */
export function matchMessageIdAt(
  matches: TranscriptMatch[],
  index: number
): string | undefined {
  if (index < 0) return undefined;
  let remaining = index;
  for (const match of matches) {
    if (remaining < match.count) return match.messageId;
    remaining -= match.count;
  }
  return undefined;
}

/**
 * Moves the active match index one step, wrapping at both ends so Enter keeps
 * cycling. Returns 0 when there's nothing to step through.
 */
export function stepMatchIndex(
  current: number,
  total: number,
  direction: SearchDirection
): number {
  if (total <= 0) return 0;
  const delta = direction === SearchDirection.Next ? 1 : -1;
  return (current + delta + total) % total;
}
