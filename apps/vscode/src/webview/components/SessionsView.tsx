import * as React from 'react';

import type { WebviewSessionSummary } from '@ext/shared/protocol';
import { PlusIcon, TrashIcon } from '@ext/webview/components/Icons';
import { logoUri } from '@ext/webview/vscode-api';

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
  onClearAll: () => void;
  onNewSession: () => void;
}

export function SessionsView({
  loading,
  sessions,
  onOpen,
  onDelete,
  onClearAll,
  onNewSession,
}: SessionsViewProps): React.JSX.Element {
  const [query, setQuery] = React.useState('');

  // Case-insensitive substring match on the title (falling back to the id for
  // untitled sessions), mirroring what the row itself displays.
  const trimmedQuery = query.trim().toLowerCase();
  const filteredSessions = trimmedQuery
    ? sessions.filter((session) =>
        `${session.title ?? 'New chat'} ${session.sessionId}`
          .toLowerCase()
          .includes(trimmedQuery)
      )
    : sessions;

  return (
    <div className="sessions-view">
      <div className="sessions-header">
        <span className="sessions-title">
          {logoUri ? (
            <img
              className="brand-logo"
              src={logoUri}
              alt=""
              aria-hidden="true"
            />
          ) : null}
          Sessions
        </span>
        <div className="sessions-header-actions">
          <button
            type="button"
            className="icon-btn"
            title="Delete all sessions"
            aria-label="Delete all sessions"
            disabled={sessions.length === 0}
            onClick={onClearAll}
          >
            <TrashIcon />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="New session"
            onClick={onNewSession}
          >
            <PlusIcon />
          </button>
        </div>
      </div>

      <div className="sessions-search">
        <input
          type="text"
          className="sessions-search-input"
          placeholder="Search sessions…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="sessions-list">
        {loading ? (
          <div className="sessions-empty">Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="sessions-empty">No sessions yet.</div>
        ) : filteredSessions.length === 0 ? (
          <div className="sessions-empty">No sessions match “{query}”.</div>
        ) : (
          filteredSessions.map((session) => (
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
