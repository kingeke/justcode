/**
 * Recency buckets shared by every session list (the sessions screen and the
 * header's session switcher), so they all read the same way: Today, Yesterday,
 * Last 7 days, Older.
 */

import type { WebviewSessionSummary } from '@ext/shared/protocol';

export const SESSION_GROUPS = [
  'Today',
  'Yesterday',
  'Last 7 days',
  'Older',
] as const;

export type SessionGroup = (typeof SESSION_GROUPS)[number];

/** Pseudo-group listing pinned sessions above the recency buckets. */
export const PINNED_GROUP = 'Pinned';

/** A recency bucket, or the pinned pseudo-group that precedes them all. */
export type SessionListGroup = typeof PINNED_GROUP | SessionGroup;

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
    { group: PINNED_GROUP as SessionListGroup, sessions: pinned },
    ...SESSION_GROUPS.map((group) => ({
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
  if (then >= startOfToday) return 'Today';
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  if (then >= startOfYesterday) return 'Yesterday';
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 7);
  if (then >= startOfWeek) return 'Last 7 days';
  return 'Older';
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
