import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  StyledText,
  createTextAttributes,
  RGBA,
  parseColor,
  type TextChunk,
} from '@opentui/core';
import { KeyName, printableInput } from '@cli/ui/key-name.js';
import { useKeyboard } from '@opentui/react';

import type { ConversationSummary } from '@core/ports/conversation-repository';
import { PROVIDER_BY_ID } from '@core/ports/provider-catalog';
import { fuzzyFilter } from '@cli/ui/fuzzy-filter.js';
import {
  defaultCollapsedGroups,
  groupPickerSessions,
  type PickerGroup,
} from '@cli/ui/session-picker-groups.js';

const VISIBLE_ROWS = 18;
const BOLD = createTextAttributes({ bold: true });
const MUTED = '#8a8a8a';
const MUTED_RGBA = RGBA.fromHex(MUTED);
const INVERSE = createTextAttributes({ inverse: true });

/** The kinds of row the session picker renders. */
export enum SessionRowKind {
  Header = 'header',
  Session = 'session',
}

/** A focusable list entry: a collapsible group header, or a session. */
type PickerRow =
  | {
      kind: SessionRowKind.Header;
      group: PickerGroup;
      count: number;
      collapsed: boolean;
    }
  | { kind: SessionRowKind.Session; session: ConversationSummary };

interface SessionPickerProps {
  sessions: ConversationSummary[];
  currentSessionId: string;
  loading?: boolean;
  onSelect: (sessionId: string) => void;
  /** Pin/unpin a session (ctrl+p on a focused session row). */
  onTogglePin: (sessionId: string, pinned: boolean) => void;
  onCancel: () => void;
}

function queryLineContent(query: string): StyledText {
  const chunks: TextChunk[] = [{ __isChunk: true, text: '> ', fg: MUTED_RGBA }];
  if (query.length === 0) {
    chunks.push({
      __isChunk: true,
      text: 'search sessions...',
      fg: MUTED_RGBA,
    });
  } else {
    chunks.push({ __isChunk: true, text: query });
  }
  chunks.push({ __isChunk: true, text: ' ', attributes: INVERSE });
  return new StyledText(chunks);
}

function groupHeaderContent(
  group: PickerGroup,
  count: number,
  collapsed: boolean,
  isSelected: boolean
): StyledText {
  return new StyledText([
    tc(isSelected ? '› ' : '  ', isSelected ? { fg: 'cyan' } : {}),
    tc(
      `${collapsed ? '▸' : '▾'} ${group} (${count})`,
      isSelected ? { fg: 'cyan', bold: true } : { fg: MUTED }
    ),
  ]);
}

function sessionLineContent(
  session: ConversationSummary,
  isSelected: boolean
): StyledText {
  return new StyledText([
    tc(isSelected ? '› ' : '  ', isSelected ? { fg: 'cyan' } : {}),
    ...(session.pinned ? [tc('★ ', { fg: 'yellow' })] : []),
    tc(
      truncate(session.title ?? session.sessionId, 48),
      isSelected ? { fg: 'cyan', bold: true } : {}
    ),
  ]);
}

function sessionMetaContent(
  session: ConversationSummary,
  isCurrent: boolean
): StyledText {
  const chunks: TextChunk[] = [
    tc(formatTimestamp(session.updatedAt), { fg: MUTED }),
    tc('  '),
    tc(`${session.messageCount} msg${session.messageCount === 1 ? '' : 's'}`, {
      fg: MUTED,
    }),
  ];

  // The provider → model the session last talked to, when it recorded one.
  if (session.model) {
    const providerName =
      PROVIDER_BY_ID[session.model.providerId]?.name ??
      session.model.providerId;
    chunks.push(
      tc('  '),
      tc(`${providerName} → ${session.model.modelId}`, { fg: MUTED })
    );
  }

  if (isCurrent) {
    chunks.push(tc('  ✓', { fg: 'green' }));
  }

  return new StyledText(chunks);
}

function tc(
  text: string,
  opts: { fg?: string; bold?: boolean } = {}
): TextChunk {
  const chunk: TextChunk = { __isChunk: true, text };
  if (opts.fg) chunk.fg = opts.fg === MUTED ? MUTED_RGBA : parseColor(opts.fg);
  if (opts.bold) chunk.attributes = BOLD;
  return chunk;
}

export function SessionPicker({
  sessions,
  currentSessionId,
  loading = false,
  onSelect,
  onTogglePin,
  onCancel,
}: SessionPickerProps): React.ReactNode {
  const [query, setQuery] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(0);
  // Recency groups folded shut (toggled with Enter on a header row) — only
  // Today and Yesterday start open. Ignored while a query is active, so
  // searching always surfaces every match.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<PickerGroup>>(() =>
    defaultCollapsedGroups()
  );
  const scrollOffsetRef = useRef(0);

  const filteredSessions = useMemo(
    () =>
      fuzzyFilter(
        sessions,
        query,
        (session) =>
          `${session.title ?? ''} ${session.sessionId} ${session.createdAt} ${session.updatedAt} ${session.messageCount}`
      ),
    [query, sessions]
  );

  // The rendered/navigable list: a header row per non-empty recency bucket,
  // followed by its sessions unless the bucket is folded shut.
  const searching = query.trim().length > 0;
  const rows = useMemo(() => {
    const built: PickerRow[] = [];
    for (const { group, sessions: inGroup } of groupPickerSessions(
      filteredSessions
    )) {
      const collapsed = !searching && collapsedGroups.has(group);
      built.push({
        kind: SessionRowKind.Header,
        group,
        count: inGroup.length,
        collapsed,
      });
      if (!collapsed) {
        built.push(
          ...inGroup.map(
            (session) => ({ kind: SessionRowKind.Session, session }) as const
          )
        );
      }
    }
    return built;
  }, [filteredSessions, collapsedGroups, searching]);
  // Mirror for the reset effect below, which must read the fresh rows without
  // re-running (and thus resetting focus) every time a group is folded.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const clampFocus = (next: number) =>
    Math.max(0, Math.min(next, rows.length - 1));

  useEffect(() => {
    // Land on the first session, not the leading group header, so Enter right
    // after opening still resumes the most recent session.
    const first = rowsRef.current[0]?.kind === SessionRowKind.Header ? 1 : 0;
    setFocusedIndex(rowsRef.current.length > first ? first : 0);
    scrollOffsetRef.current = 0;
  }, [query, sessions]);

  useKeyboard((key) => {
    if (key.name === KeyName.Escape || (key.ctrl && key.name === KeyName.C)) {
      onCancel();
      return;
    }

    if (key.ctrl && key.name === KeyName.P) {
      const row = rows[focusedIndex];
      if (row?.kind === SessionRowKind.Session) {
        onTogglePin(row.session.sessionId, !row.session.pinned);
      }
      return;
    }

    if (key.name === KeyName.Return) {
      const row = rows[focusedIndex];
      if (!row) return;
      if (row.kind === SessionRowKind.Session) {
        onSelect(row.session.sessionId);
        return;
      }
      // Enter on a header folds/unfolds its group; focus stays on the header
      // (rows only change after it, so the index still points at it).
      setCollapsedGroups((prev) => {
        const next = new Set(prev);
        if (next.has(row.group)) next.delete(row.group);
        else next.add(row.group);
        return next;
      });
      return;
    }

    if (key.name === KeyName.Down) {
      const next = clampFocus(focusedIndex + 1);
      setFocusedIndex(next);
      if (next >= scrollOffsetRef.current + VISIBLE_ROWS) {
        scrollOffsetRef.current = next - VISIBLE_ROWS + 1;
      }
      return;
    }

    if (key.name === KeyName.Up) {
      const next = clampFocus(focusedIndex - 1);
      setFocusedIndex(next);
      if (next < scrollOffsetRef.current) {
        scrollOffsetRef.current = next;
      }
      return;
    }

    if (key.name === KeyName.Backspace || key.name === KeyName.Delete) {
      setQuery((prev) => prev.slice(0, -1));
      return;
    }

    if (
      (key.meta && key.name === KeyName.V) ||
      (key.shift && key.name === KeyName.Insert)
    ) {
      // Clipboard paste isn't supported here yet; session IDs stay single-line.
      return;
    }

    const input = printableInput(key);
    if (input) {
      setQuery((prev) => prev + input);
    }
  });

  const visibleRows = rows.slice(
    scrollOffsetRef.current,
    scrollOffsetRef.current + VISIBLE_ROWS
  );

  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor="cyan"
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <text fg="cyan" attributes={BOLD}>
          Resume session
        </text>
        <text fg={MUTED}>
          enter to load · ctrl+p to pin · enter on a group folds it · esc to
          cancel
        </text>
      </box>

      <box marginBottom={1}>
        <text content={queryLineContent(query)} />
      </box>

      {loading ? (
        <text fg={MUTED}>Loading sessions...</text>
      ) : filteredSessions.length === 0 ? (
        <text fg={MUTED}>
          {query.length === 0
            ? 'No saved sessions yet.'
            : 'No saved sessions match.'}
        </text>
      ) : (
        <box flexDirection="column">
          {visibleRows.map((row, index) => {
            const absoluteIndex = scrollOffsetRef.current + index;
            const isSelected = absoluteIndex === focusedIndex;

            if (row.kind === SessionRowKind.Header) {
              return (
                <box
                  key={`header-${row.group}`}
                  flexDirection="row"
                  flexShrink={0}
                >
                  <text
                    content={groupHeaderContent(
                      row.group,
                      row.count,
                      row.collapsed,
                      isSelected
                    )}
                  />
                </box>
              );
            }

            const isCurrent = row.session.sessionId === currentSessionId;
            return (
              <box
                key={row.session.sessionId}
                flexDirection="row"
                flexShrink={0}
              >
                <box flexGrow={1}>
                  <text content={sessionLineContent(row.session, isSelected)} />
                </box>
                <text content={sessionMetaContent(row.session, isCurrent)} />
              </box>
            );
          })}
          {rows.length > VISIBLE_ROWS ? (
            <text fg={MUTED}>
              {'\n'}
              {scrollOffsetRef.current + VISIBLE_ROWS < rows.length
                ? `↓ ${rows.length - scrollOffsetRef.current - VISIBLE_ROWS} more`
                : ''}
            </text>
          ) : null}
        </box>
      )}
    </box>
  );
}

function formatTimestamp(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}
