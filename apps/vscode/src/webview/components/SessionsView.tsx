import * as React from 'react';

import type { WebviewSessionSummary } from '@ext/shared/protocol';
import { PencilIcon, PlusIcon, TrashIcon } from '@ext/webview/components/Icons';
import { logoUri } from '@ext/webview/vscode-api';
import {
  SESSION_GROUPS,
  relativeTime,
  sessionGroupFor,
  type SessionGroup,
} from '@ext/webview/session-groups';

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
  // Recency groups the user folded shut. Ignored while searching, so a query
  // always surfaces every match.
  const [collapsedGroups, setCollapsedGroups] = React.useState<
    Set<SessionGroup>
  >(() => new Set());

  const toggleGroup = (group: SessionGroup): void => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };
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
  const groupedSessions = SESSION_GROUPS.map((group) => ({
    group,
    sessions: filteredSessions.filter(
      (session) => sessionGroupFor(session.updatedAt) === group
    ),
  })).filter((bucket) => bucket.sessions.length > 0);

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
          groupedSessions.map(({ group, sessions: groupSessions }) => {
            const folded = !trimmedQuery && collapsedGroups.has(group);
            return (
              <React.Fragment key={group}>
                <button
                  type="button"
                  className="sessions-group"
                  title={folded ? 'Expand' : 'Collapse'}
                  aria-expanded={!folded}
                  onClick={() => toggleGroup(group)}
                >
                  <span aria-hidden="true">{folded ? '▸' : '▾'}</span> {group} (
                  {groupSessions.length})
                </button>
                {folded
                  ? null
                  : groupSessions.map((session) => {
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
          })}
              </React.Fragment>
            );
          })
        )}
      </div>
    </div>
  );
}
