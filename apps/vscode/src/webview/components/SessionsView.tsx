import * as React from 'react';

import type { WebviewSessionSummary } from '@ext/shared/protocol';
import { PlusIcon, TrashIcon } from '@ext/webview/components/Icons';

function relativeTime(iso: string): string {
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

interface SessionsViewProps {
  loading: boolean;
  sessions: WebviewSessionSummary[];
  onOpen: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onNewSession: () => void;
}

export function SessionsView({
  loading,
  sessions,
  onOpen,
  onDelete,
  onNewSession,
}: SessionsViewProps): React.JSX.Element {
  return (
    <div className="sessions-view">
      <div className="sessions-header">
        <span className="sessions-title">Sessions</span>
        <button
          type="button"
          className="icon-btn"
          title="New session"
          onClick={onNewSession}
        >
          <PlusIcon />
        </button>
      </div>

      <div className="sessions-list">
        {loading ? (
          <div className="sessions-empty">Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="sessions-empty">No sessions yet.</div>
        ) : (
          sessions.map((session) => (
            <div key={session.sessionId} className="session-row">
              <button
                type="button"
                className="session-item"
                onClick={() => onOpen(session.sessionId)}
              >
                <span className="session-item-title">
                  {session.title ?? 'New chat'}
                </span>
                <span className="session-item-meta">
                  {session.messageCount} msg
                  {session.messageCount !== 1 ? 's' : ''} ·{' '}
                  {relativeTime(session.updatedAt)}
                </span>
              </button>
              <button
                type="button"
                className="icon-btn session-delete-btn"
                title="Delete session"
                aria-label="Delete session"
                onClick={() => onDelete(session.sessionId)}
              >
                <TrashIcon size={15} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
