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
import {
  defaultCollapsedGroups,
  PinnedGroup,
  SessionGroup,
} from '@ext/webview/session-groups';

const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

const sessions: WebviewSessionSummary[] = [
  {
    sessionId: 'today-session',
    title: 'Today chat',
    updatedAt: daysAgo(0),
    messageCount: 1,
  },
  {
    sessionId: 'yesterday-session',
    title: 'Yesterday chat',
    updatedAt: daysAgo(1),
    messageCount: 1,
  },
  {
    sessionId: 'week-session',
    title: 'Week chat',
    updatedAt: daysAgo(3),
    messageCount: 1,
  },
  {
    sessionId: 'older-session',
    title: 'Older chat',
    updatedAt: daysAgo(30),
    messageCount: 1,
  },
  {
    sessionId: 'pinned-session',
    title: 'Pinned chat',
    updatedAt: daysAgo(30),
    messageCount: 1,
    pinned: true,
  },
];

describe('defaultCollapsedGroups', () => {
  it('collapses only the Last 7 days and Older buckets', () => {
    const collapsed = defaultCollapsedGroups();

    expect(collapsed.has(SessionGroup.LastSevenDays)).toBe(true);
    expect(collapsed.has(SessionGroup.Older)).toBe(true);
    expect(collapsed.has(SessionGroup.Today)).toBe(false);
    expect(collapsed.has(SessionGroup.Yesterday)).toBe(false);
    expect(collapsed.has(PinnedGroup.Pinned)).toBe(false);
  });
});

describe('SessionsView default collapse', () => {
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

  it('opens Pinned, Today and Yesterday by default', () => {
    expect(markup).toContain('Pinned chat');
    expect(markup).toContain('Today chat');
    expect(markup).toContain('Yesterday chat');
  });

  it('folds Last 7 days and Older shut, keeping their headers and counts', () => {
    expect(markup).not.toContain('Week chat');
    expect(markup).not.toContain('Older chat');
    expect(markup).toContain('Last 7 days (1)');
    expect(markup).toContain('Older (1)');
  });
});

describe('SessionSwitcher default collapse', () => {
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

  it('opens Pinned, Today and Yesterday by default', () => {
    expect(markup).toContain('Pinned chat');
    expect(markup).toContain('Yesterday chat');
  });

  it('folds Last 7 days and Older shut, keeping their headers and counts', () => {
    expect(markup).not.toContain('Week chat');
    expect(markup).not.toContain('Older chat');
    expect(markup).toContain('Last 7 days (1)');
    expect(markup).toContain('Older (1)');
  });
});
