import { describe, expect, it } from 'vitest';

import { HostMessageType } from '@ext/shared/protocol';
import { ChatStatus, initialState, reducer } from '@ext/webview/state';

describe('SessionsList focus behavior', () => {
  const inChat = {
    ...initialState,
    status: ChatStatus.Ready,
    view: 'chat' as const,
    hasConnectedProvider: true,
  };

  it('switches to the sessions view when focus is true', () => {
    const next = reducer(inChat, {
      type: HostMessageType.SessionsList,
      sessions: [],
      hasConnectedProvider: true,
      focus: true,
    });

    expect(next.view).toBe('sessions');
  });

  it('defaults to focusing the sessions view when focus is omitted', () => {
    const next = reducer(inChat, {
      type: HostMessageType.SessionsList,
      sessions: [],
      hasConnectedProvider: true,
    });

    expect(next.view).toBe('sessions');
  });

  it('refreshes session data in place without leaving chat when focus is false', () => {
    const next = reducer(inChat, {
      type: HostMessageType.SessionsList,
      sessions: [{ sessionId: 's1', updatedAt: 1, messageCount: 3 }],
      hasConnectedProvider: true,
      focus: false,
    });

    // Stays on the chat view — the user isn't yanked to the sessions list.
    expect(next.view).toBe('chat');
    // But the session data is still refreshed.
    expect(next.sessions).toHaveLength(1);
    expect(next.hasConnectedProvider).toBe(true);
  });
});
