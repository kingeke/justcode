import type { ConversationSummary } from '@core/ports/conversation-repository';

/** Recency buckets, in display order (mirrors the extension's session lists). */
export enum SessionGroup {
  Today = 'Today',
  Yesterday = 'Yesterday',
  LastSevenDays = 'Last 7 days',
  Older = 'Older',
}

/** Pseudo-group listing the user's pinned sessions above the recency buckets. */
export enum PinnedGroup {
  Pinned = 'Pinned',
}

/** A recency bucket, or the pinned pseudo-group that precedes them all. */
export type PickerGroup = SessionGroup | PinnedGroup;

export function sessionGroupFor(iso: string): SessionGroup {
  const then = new Date(iso);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  if (then >= startOfToday) return SessionGroup.Today;
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  if (then >= startOfYesterday) return SessionGroup.Yesterday;
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 7);
  if (then >= startOfWeek) return SessionGroup.LastSevenDays;
  return SessionGroup.Older;
}

/**
 * Buckets sessions for display: pinned ones first (lifted out of their recency
 * bucket so they stay at the top however old they get), then the recency
 * groups. Empty buckets are dropped. Mirrors the extension's `groupSessions`.
 */
export function groupPickerSessions(
  sessions: ConversationSummary[]
): { group: PickerGroup; sessions: ConversationSummary[] }[] {
  const pinned = sessions.filter((session) => session.pinned);
  const unpinned = sessions.filter((session) => !session.pinned);
  return [
    { group: PinnedGroup.Pinned as PickerGroup, sessions: pinned },
    ...Object.values(SessionGroup).map((group) => ({
      group: group as PickerGroup,
      sessions: unpinned.filter(
        (session) => sessionGroupFor(session.updatedAt) === group
      ),
    })),
  ].filter((bucket) => bucket.sessions.length > 0);
}
