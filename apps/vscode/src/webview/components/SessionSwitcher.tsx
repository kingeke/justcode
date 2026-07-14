import * as React from 'react';

import type { WebviewSessionSummary } from '@ext/shared/protocol';
import {
  ChevronDownIcon,
  PencilIcon,
  PinIcon,
  TrashIcon,
} from '@ext/webview/components/Icons';

import {
  defaultCollapsedGroups,
  groupSessions,
  relativeTime,
  type SessionListGroup,
} from '@ext/webview/session-groups';

interface SessionSwitcherProps {
  /** The current session's display title (the header label). */
  title: string;
  sessions: WebviewSessionSummary[];
  /** The session currently open in the chat view; its row reads in accent blue. */
  currentSessionId?: string | undefined;
  /** Sessions with a turn still running in the host; shown as "Working…". */
  activeSessionIds?: string[] | undefined;
  /** Locks the switcher (e.g. while the conversation is compacting). */
  disabled: boolean;
  onOpen: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => void;
  /** Pin or unpin a session; pinned sessions list in their own group. */
  onPin: (sessionId: string, pinned: boolean) => void;
  onDelete: (sessionId: string) => void;
  /** Refresh the session data in place (no view switch) when the popup opens. */
  onRefreshSessions: () => void;
  /** Start with the popup open (used by static-render tests). */
  defaultOpen?: boolean | undefined;
}

/**
 * The chat header's title as a drop-down session switcher: click to search
 * the saved sessions, jump to one, rename, or delete — without leaving the
 * chat for the full sessions screen.
 */
export function SessionSwitcher(
  props: SessionSwitcherProps
): React.JSX.Element {
  const [open, setOpen] = React.useState(props.defaultOpen ?? false);
  const [query, setQuery] = React.useState('');
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draftTitle, setDraftTitle] = React.useState('');
  // Recency groups folded shut — only Today and Yesterday start open. Ignored
  // while searching, so a query always surfaces every match.
  const [collapsedGroups, setCollapsedGroups] = React.useState<
    Set<SessionListGroup>
  >(() => defaultCollapsedGroups());
  const anchorRef = React.useRef<HTMLDivElement>(null);

  const toggleGroup = (group: SessionListGroup): void => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const { onRefreshSessions } = props;
  const toggle = (): void => {
    setOpen((wasOpen) => {
      if (!wasOpen) {
        // Fresh data every open — sessions may have changed in other windows.
        onRefreshSessions();
        setQuery('');
        setEditingId(null);
      }
      return !wasOpen;
    });
  };

  // Close on outside click or Escape, mirroring the composer popups.
  React.useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (event: MouseEvent): void => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const commitRename = (sessionId: string): void => {
    const trimmed = draftTitle.trim();
    const current =
      props.sessions.find((s) => s.sessionId === sessionId)?.title ?? '';
    // Only send when it actually changed and isn't blank, so a stray Enter or
    // blur doesn't clear a title.
    if (trimmed && trimmed !== current) props.onRename(sessionId, trimmed);
    setEditingId(null);
  };

  const trimmedQuery = query.trim().toLowerCase();
  const filtered = trimmedQuery
    ? props.sessions.filter((session) =>
        `${session.title ?? 'New chat'} ${session.sessionId}`
          .toLowerCase()
          .includes(trimmedQuery)
      )
    : props.sessions;
  const grouped = groupSessions(filtered);

  return (
    <div className="session-switcher" ref={anchorRef}>
      <button
        type="button"
        className={`chat-title session-switcher-btn ${open ? 'session-switcher-btn-open' : ''}`}
        title="Switch session"
        disabled={props.disabled}
        onClick={toggle}
      >
        <span className="session-switcher-label">{props.title}</span>
        <ChevronDownIcon size={12} />
      </button>

      {open ? (
        <div className="session-switcher-popup">
          <input
            type="text"
            className="sessions-search-input"
            placeholder="Search sessions by name"
            value={query}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="session-switcher-list">
            {props.sessions.length === 0 ? (
              <div className="sessions-empty">No sessions yet.</div>
            ) : filtered.length === 0 ? (
              <div className="sessions-empty">No sessions match “{query}”.</div>
            ) : (
              grouped.map(({ group, sessions }) => {
                const folded = !trimmedQuery && collapsedGroups.has(group);
                return (
                  <React.Fragment key={group}>
                    <button
                      type="button"
                      className="session-switcher-group"
                      title={folded ? 'Expand' : 'Collapse'}
                      aria-expanded={!folded}
                      onClick={() => toggleGroup(group)}
                    >
                      <span aria-hidden="true">{folded ? '▸' : '▾'}</span>{' '}
                      {group} ({sessions.length})
                    </button>
                    {folded
                      ? null
                      : sessions.map((session) => {
                          const isCurrent =
                            session.sessionId === props.currentSessionId;
                          const isEditing = session.sessionId === editingId;
                          const isWorking =
                            props.activeSessionIds?.includes(
                              session.sessionId
                            ) ?? false;
                          return (
                            <div
                              key={session.sessionId}
                              className={`session-switcher-row ${isCurrent ? 'session-switcher-row-current' : ''}`}
                            >
                              {isEditing ? (
                                <input
                                  type="text"
                                  className="session-rename-input"
                                  value={draftTitle}
                                  // eslint-disable-next-line jsx-a11y/no-autofocus
                                  autoFocus
                                  onChange={(event) =>
                                    setDraftTitle(event.target.value)
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter')
                                      commitRename(session.sessionId);
                                    else if (event.key === 'Escape')
                                      setEditingId(null);
                                    // Keep Escape from also closing the popup.
                                    event.stopPropagation();
                                  }}
                                  onBlur={() => commitRename(session.sessionId)}
                                />
                              ) : (
                                <button
                                  type="button"
                                  className="session-switcher-item"
                                  onClick={() => {
                                    setOpen(false);
                                    if (!isCurrent)
                                      props.onOpen(session.sessionId);
                                  }}
                                >
                                  <span className="session-switcher-item-title">
                                    {isWorking ? (
                                      <span
                                        className="session-loading-dot"
                                        aria-hidden="true"
                                      />
                                    ) : null}
                                    {session.title ?? 'New chat'}
                                  </span>
                                  <span className="session-switcher-item-meta">
                                    {isWorking ? (
                                      <span className="session-loading-label">
                                        Working…
                                      </span>
                                    ) : (
                                      relativeTime(session.updatedAt)
                                    )}
                                  </span>
                                </button>
                              )}
                              {isEditing ? null : (
                                <span className="session-switcher-actions">
                                  <button
                                    type="button"
                                    className={`icon-btn ${session.pinned ? 'icon-btn-active' : ''}`}
                                    title={
                                      session.pinned
                                        ? 'Unpin session'
                                        : 'Pin session'
                                    }
                                    aria-label={
                                      session.pinned
                                        ? 'Unpin session'
                                        : 'Pin session'
                                    }
                                    aria-pressed={session.pinned ?? false}
                                    onClick={() =>
                                      props.onPin(
                                        session.sessionId,
                                        !session.pinned
                                      )
                                    }
                                  >
                                    <PinIcon
                                      size={13}
                                      filled={session.pinned ?? false}
                                    />
                                  </button>
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    title="Rename session"
                                    aria-label="Rename session"
                                    onClick={() => {
                                      setEditingId(session.sessionId);
                                      setDraftTitle(session.title ?? '');
                                    }}
                                  >
                                    <PencilIcon size={13} />
                                  </button>
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    title="Delete session"
                                    aria-label="Delete session"
                                    onClick={() =>
                                      props.onDelete(session.sessionId)
                                    }
                                  >
                                    <TrashIcon size={14} />
                                  </button>
                                </span>
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
      ) : null}
    </div>
  );
}
