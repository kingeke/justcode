import * as React from 'react';

import type { WebviewSessionSummary } from '@ext/shared/protocol';
import { PencilIcon, PlusIcon, TrashIcon } from '@ext/webview/components/Icons';
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
  /** Session with a turn still running in the host — shown as loading. */
  activeSessionId?: string | undefined;
  onOpen: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => void;
  onDelete: (sessionId: string) => void;
  onClearAll: () => void;
  onNewSession: () => void;
}

export function SessionsView({
  loading,
  sessions,
  activeSessionId,
  onOpen,
  onRename,
  onDelete,
  onClearAll,
  onNewSession,
}: SessionsViewProps): React.JSX.Element {
  const [query, setQuery] = React.useState('');
  // The session whose title is being edited inline, and the working text.
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draftTitle, setDraftTitle] = React.useState('');
  // The session being opened in the host; its row shows a spinner instead of
  // the rename/delete actions until the view switches (unmounting us).
  const [openingId, setOpeningId] = React.useState<string | null>(null);

  const openSession = (sessionId: string): void => {
    if (openingId) return;
    setOpeningId(sessionId);
    onOpen(sessionId);
  };

  const startRename = (session: WebviewSessionSummary): void => {
    setEditingId(session.sessionId);
    setDraftTitle(session.title ?? '');
  };

  const commitRename = (sessionId: string): void => {
    const trimmed = draftTitle.trim();
    // Only send when it actually changed and isn't blank, so a stray Enter or
    // blur doesn't clear a title.
    const current =
      sessions.find((s) => s.sessionId === sessionId)?.title ?? '';
    if (trimmed && trimmed !== current) onRename(sessionId, trimmed);
    setEditingId(null);
  };

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
          filteredSessions.map((session) => {
            const isActive = session.sessionId === activeSessionId;
            const isEditing = session.sessionId === editingId;
            const isOpening = session.sessionId === openingId;
            return (
              <div key={session.sessionId} className="session-row">
                {isEditing ? (
                  <input
                    type="text"
                    className="session-rename-input"
                    value={draftTitle}
                    autoFocus
                    onChange={(event) => setDraftTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter')
                        commitRename(session.sessionId);
                      else if (event.key === 'Escape') setEditingId(null);
                    }}
                    onBlur={() => commitRename(session.sessionId)}
                  />
                ) : (
                  <button
                    type="button"
                    className="session-item"
                    onClick={() => openSession(session.sessionId)}
                  >
                    <span className="session-item-title">
                      {isActive ? (
                        <span
                          className="session-loading-dot"
                          aria-hidden="true"
                        />
                      ) : null}
                      {session.title ?? 'New chat'}
                    </span>
                    <span className="session-item-meta">
                      {isActive ? (
                        <span className="session-loading-label">Working…</span>
                      ) : (
                        <>
                          {session.messageCount} msg
                          {session.messageCount !== 1 ? 's' : ''} ·{' '}
                          {relativeTime(session.updatedAt)}
                        </>
                      )}
                    </span>
                  </button>
                )}
                {isEditing ? null : isOpening ? (
                  <span
                    className="session-opening-spinner"
                    role="status"
                    aria-label="Opening session"
                  >
                    <span className="spinner" aria-hidden="true" />
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      className="icon-btn session-rename-btn"
                      title="Rename session"
                      aria-label="Rename session"
                      onClick={() => startRename(session)}
                    >
                      <PencilIcon size={14} />
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
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
