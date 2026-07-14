/**
 * Recency buckets shared by every session list (the sessions screen and the
 * header's session switcher), so they all read the same way: Today, Yesterday,
 * Last 7 days, Older.
 */

import type { WebviewSessionSummary } from '@ext/shared/protocol';

/** Recency buckets, in display order. */
export enum SessionGroup {
  Today = 'Today',
  Yesterday = 'Yesterday',
  LastSevenDays = 'Last 7 days',
  Older = 'Older',
}

/** Pseudo-group listing pinned sessions above the recency buckets. */
export enum PinnedGroup {
  Pinned = 'Pinned',
}

/** A recency bucket, or the pinned pseudo-group that precedes them all. */
export type SessionListGroup = PinnedGroup | SessionGroup;

/**
 * The groups every session list starts with folded shut: only Pinned, Today
 * and Yesterday are open by default, keeping recent work in view while the
 * long tail stays tucked away until the user expands it.
 */
export function defaultCollapsedGroups(): Set<SessionListGroup> {
  return new Set<SessionListGroup>([
    SessionGroup.LastSevenDays,
    SessionGroup.Older,
  ]);
}

/**
 * Buckets sessions for display: pinned ones first (lifted out of their recency
 * bucket so they stay at the top however old they get), then the recency
 * groups. Empty buckets are dropped. Shared by the sessions screen and the
 * header's session switcher so both lists read the same way.
 */
export function groupSessions(
  sessions: WebviewSessionSummary[]
): { group: SessionListGroup; sessions: WebviewSessionSummary[] }[] {
  const pinned = sessions.filter((session) => session.pinned);
  const unpinned = sessions.filter((session) => !session.pinned);
  return [
    { group: PinnedGroup.Pinned as SessionListGroup, sessions: pinned },
    ...Object.values(SessionGroup).map((group) => ({
      group: group as SessionListGroup,
      sessions: unpinned.filter(
        (session) => sessionGroupFor(session.updatedAt) === group
      ),
    })),
  ].filter((bucket) => bucket.sessions.length > 0);
}

/**
 * The session ids adjacent to `currentSessionId` in the order the session lists
 * display them (pinned first, then by recency). Drives the header's
 * previous/next buttons; either side is undefined at the ends of the list, or
 * when the current session isn't in it yet (e.g. a brand new chat).
 */
export function adjacentSessions(
  sessions: WebviewSessionSummary[],
  currentSessionId: string | undefined
): { previousSessionId?: string; nextSessionId?: string } {
  const ordered = groupSessions(sessions).flatMap((bucket) => bucket.sessions);
  const index = ordered.findIndex(
    (session) => session.sessionId === currentSessionId
  );
  if (index === -1) return {};
  const previous = ordered[index - 1];
  const next = ordered[index + 1];
  return {
    ...(previous ? { previousSessionId: previous.sessionId } : {}),
    ...(next ? { nextSessionId: next.sessionId } : {}),
  };
}

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

export function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
