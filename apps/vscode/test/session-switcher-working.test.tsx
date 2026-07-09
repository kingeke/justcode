import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { WebviewSessionSummary } from '@ext/shared/protocol';
import { SessionSwitcher } from '@ext/webview/components/SessionSwitcher';

const sessions: WebviewSessionSummary[] = [
  {
    sessionId: 'busy-session',
    title: 'Busy session',
    updatedAt: new Date().toISOString(),
    messageCount: 4,
  },
  {
    sessionId: 'idle-session',
    title: 'Idle session',
    updatedAt: new Date().toISOString(),
    messageCount: 2,
  },
];

function render(activeSessionIds?: string[]): string {
  return renderToStaticMarkup(
    <SessionSwitcher
      title="Busy session"
      sessions={sessions}
      currentSessionId="busy-session"
      activeSessionIds={activeSessionIds}
      disabled={false}
      onOpen={() => {}}
      onRename={() => {}}
      onPin={() => {}}
      onDelete={() => {}}
      onRefreshSessions={() => {}}
      defaultOpen
    />
  );
}

describe('SessionSwitcher working indicator', () => {
  it('marks sessions with a running turn with a pulsing dot and "Working…"', () => {
    const markup = render(['busy-session']);

    expect(markup).toContain('session-loading-dot');
    expect(markup).toContain('session-loading-label');
    expect(markup).toContain('Working…');
    // The dot precedes the busy session's row title (skip the header label,
    // which repeats the current session's title), not the idle one's.
    const listStart = markup.indexOf('session-switcher-list');
    expect(markup.indexOf('session-loading-dot')).toBeLessThan(
      markup.indexOf('Busy session', listStart)
    );
    expect(markup.indexOf('Idle session')).toBeLessThan(
      markup.lastIndexOf('session-switcher-item-meta')
    );
  });

  it('shows only relative times when no session is working', () => {
    const markup = render(undefined);

    expect(markup).not.toContain('session-loading-dot');
    expect(markup).not.toContain('Working…');
  });
});
