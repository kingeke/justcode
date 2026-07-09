import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// SessionsView pulls in the webview's VS Code API handle for its logo; outside
// a webview `acquireVsCodeApi` doesn't exist, so stub the module.
vi.mock('@ext/webview/vscode-api', () => ({
  logoUri: undefined,
  postToHost: () => {},
}));

import type { WebviewSessionSummary } from '@ext/shared/protocol';
import { SessionsView } from '@ext/webview/components/SessionsView';
import { SessionSwitcher } from '@ext/webview/components/SessionSwitcher';
import { adjacentSessions, groupSessions } from '@ext/webview/session-groups';

const now = new Date().toISOString();
const lastMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

const sessions: WebviewSessionSummary[] = [
  {
    sessionId: 'today-session',
    title: 'Today chat',
    updatedAt: now,
    messageCount: 2,
  },
  {
    sessionId: 'pinned-session',
    title: 'Pinned chat',
    updatedAt: lastMonth,
    messageCount: 5,
    pinned: true,
  },
];

describe('groupSessions', () => {
  it('puts pinned sessions in their own group above the recency buckets', () => {
    const grouped = groupSessions(sessions);

    expect(grouped.map((bucket) => bucket.group)).toEqual(['Pinned', 'Today']);
    expect(grouped[0]?.sessions.map((s) => s.sessionId)).toEqual([
      'pinned-session',
    ]);
    // Lifted out of "Older", not duplicated into both groups.
    expect(grouped[1]?.sessions.map((s) => s.sessionId)).toEqual([
      'today-session',
    ]);
  });

  it('omits the pinned group when nothing is pinned', () => {
    const grouped = groupSessions([sessions[0] as WebviewSessionSummary]);

    expect(grouped.map((bucket) => bucket.group)).toEqual(['Today']);
  });
});

describe('adjacentSessions', () => {
  // Display order is pinned first, then recency: pinned-session, today-session.
  it('reports no previous session at the top of the list', () => {
    expect(adjacentSessions(sessions, 'pinned-session')).toEqual({
      nextSessionId: 'today-session',
    });
  });

  it('reports no next session at the bottom of the list', () => {
    expect(adjacentSessions(sessions, 'today-session')).toEqual({
      previousSessionId: 'pinned-session',
    });
  });

  it('reports both neighbours in the middle of the list', () => {
    const middle: WebviewSessionSummary[] = [
      ...sessions,
      { sessionId: 'oldest', updatedAt: lastMonth, messageCount: 1 },
    ];

    expect(adjacentSessions(middle, 'today-session')).toEqual({
      previousSessionId: 'pinned-session',
      nextSessionId: 'oldest',
    });
  });

  it('reports neither side for a session that is not in the list yet', () => {
    expect(adjacentSessions(sessions, 'brand-new')).toEqual({});
    expect(adjacentSessions(sessions, undefined)).toEqual({});
  });
});

describe('SessionsView pinning', () => {
  const markup = renderToStaticMarkup(
    <SessionsView
      loading={false}
      sessions={sessions}
      onOpen={() => {}}
      onRename={() => {}}
      onPin={() => {}}
      onDelete={() => {}}
      onClearAll={() => {}}
      onNewSession={() => {}}
    />
  );

  it('renders a Pinned group before the recency groups', () => {
    expect(markup).toContain('Pinned (1)');
    expect(markup.indexOf('Pinned (1)')).toBeLessThan(
      markup.indexOf('Today (1)')
    );
  });

  it('offers a pin action per row, reflecting the current state', () => {
    expect(markup).toContain('aria-label="Pin session"');
    expect(markup).toContain('aria-label="Unpin session"');
  });
});

describe('SessionSwitcher pinning', () => {
  const markup = renderToStaticMarkup(
    <SessionSwitcher
      title="Today chat"
      sessions={sessions}
      currentSessionId="today-session"
      disabled={false}
      onOpen={() => {}}
      onRename={() => {}}
      onPin={() => {}}
      onDelete={() => {}}
      onRefreshSessions={() => {}}
      defaultOpen
    />
  );

  it('shows the pinned group and a pin toggle in the header popup', () => {
    expect(markup).toContain('Pinned (1)');
    expect(markup).toContain('aria-label="Unpin session"');
    expect(markup.indexOf('Pinned (1)')).toBeLessThan(
      markup.indexOf('Today (1)')
    );
  });
});
