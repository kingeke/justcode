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
import { fuzzyFilter } from '@cli/ui/fuzzy-filter.js';

const VISIBLE_ROWS = 18;
const BOLD = createTextAttributes({ bold: true });
const MUTED = '#8a8a8a';
const MUTED_RGBA = RGBA.fromHex(MUTED);
const INVERSE = createTextAttributes({ inverse: true });

interface SessionPickerProps {
  sessions: ConversationSummary[];
  currentSessionId: string;
  loading?: boolean;
  onSelect: (sessionId: string) => void;
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

function sessionLineContent(
  session: ConversationSummary,
  isSelected: boolean
): StyledText {
  return new StyledText([
    tc(isSelected ? '› ' : '  ', isSelected ? { fg: 'cyan' } : {}),
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
  onCancel,
}: SessionPickerProps): React.ReactNode {
  const [query, setQuery] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(0);
  const scrollOffsetRef = useRef(0);

  const filteredSessions = useMemo(
    () =>
      fuzzyFilter(
        sessions,
        query,
        (session) =>
          `${session.sessionId} ${session.createdAt} ${session.updatedAt} ${session.messageCount}`
      ),
    [query, sessions]
  );

  const clampFocus = (next: number) =>
    Math.max(0, Math.min(next, filteredSessions.length - 1));

  useEffect(() => {
    setFocusedIndex(0);
    scrollOffsetRef.current = 0;
  }, [query, sessions]);

  useKeyboard((key) => {
    if (key.name === KeyName.Escape || (key.ctrl && key.name === KeyName.C)) {
      onCancel();
      return;
    }

    if (key.name === KeyName.Return) {
      const session = filteredSessions[focusedIndex];
      if (session) onSelect(session.sessionId);
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

  const visibleSessions = filteredSessions.slice(
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
        <text fg={MUTED}>enter to load · esc to cancel</text>
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
          {visibleSessions.map((session, index) => {
            const absoluteIndex = scrollOffsetRef.current + index;
            const isSelected = absoluteIndex === focusedIndex;
            const isCurrent = session.sessionId === currentSessionId;

            return (
              <box key={session.sessionId} flexDirection="row" flexShrink={0}>
                <box flexGrow={1}>
                  <text content={sessionLineContent(session, isSelected)} />
                </box>
                <text content={sessionMetaContent(session, isCurrent)} />
              </box>
            );
          })}
          {filteredSessions.length > VISIBLE_ROWS ? (
            <text fg={MUTED}>
              {'\n'}
              {scrollOffsetRef.current + VISIBLE_ROWS < filteredSessions.length
                ? `↓ ${filteredSessions.length - scrollOffsetRef.current - VISIBLE_ROWS} more`
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
