/**
 * Shared helpers for bounding how much prior conversation history is sent to
 * the model. Trimming old turns keeps each request cheaper (fewer input tokens)
 * without touching what we persist — the full conversation is always saved; only
 * the slice handed to the provider is capped (see `ChatSessionService` and the
 * `/history-limit` command).
 */

import type { ChatMessage } from '@core/domain/message';

/**
 * Default number of most-recent messages forwarded to the model per request. A
 * default only: the runtime overrides it from user config (see
 * `create-services`/`create-cli` and the `/history-limit` command).
 */
export const DEFAULT_MAX_HISTORY_MESSAGES = 50;

/**
 * Return the most recent `limit` messages, never starting the window on an
 * orphaned `tool` result. A tool message whose preceding assistant `tool_call`
 * was trimmed away is rejected by most providers, so once the window has been
 * sliced we walk its start forward past any leading tool messages. The current
 * turn always sits at the tail, so it is preserved intact.
 */
export function selectRecentMessages(
  messages: ChatMessage[],
  limit: number
): ChatMessage[] {
  if (limit <= 0 || messages.length <= limit) {
    return messages;
  }

  let start = messages.length - limit;
  while (start < messages.length && messages[start]?.role === 'tool') {
    start += 1;
  }

  // Degenerate guard (tiny limit landing mid tool-burst): never send an empty
  // history — fall back to the raw tail, accepting it over nothing.
  if (start >= messages.length) {
    start = messages.length - limit;
  }

  return messages.slice(start);
}

/** Per-message character cap when rendering a history window, so paging back
 * into old turns can't itself flood the context. Longer bodies are truncated
 * and flagged. */
export const MAX_HISTORY_MESSAGE_LENGTH = 4000;

/** Largest number of messages a single `view_history` call may return. */
export const MAX_HISTORY_WINDOW = 50;

export interface RenderHistoryWindowResult {
  content: string;
  isError: boolean;
}

/**
 * Render messages `[start, end)` (0-based, `end` exclusive) of `messages` as a
 * numbered, role-tagged transcript for the `view_history` tool. `end` defaults
 * to a bounded window after `start`. Indices are clamped to the array; an empty
 * or out-of-range request reports the valid range instead of erroring hard.
 */
export function renderHistoryWindow(
  messages: ChatMessage[],
  start: number,
  end?: number
): RenderHistoryWindowResult {
  const total = messages.length;
  if (total === 0) {
    return { content: 'No conversation history yet.', isError: false };
  }

  const safeStart = clampIndex(Math.floor(start), 0, total);
  const requestedEnd =
    end === undefined ? safeStart + MAX_HISTORY_WINDOW : Math.floor(end);
  const cappedEnd = Math.min(requestedEnd, safeStart + MAX_HISTORY_WINDOW);
  const safeEnd = clampIndex(cappedEnd, safeStart, total);

  if (safeStart >= safeEnd) {
    return {
      content: `No messages in range [${safeStart}, ${safeEnd}). The conversation has ${total} message(s), indexed 0 (oldest) to ${total - 1} (most recent).`,
      isError: true,
    };
  }

  const lines = messages
    .slice(safeStart, safeEnd)
    .map((message, offset) =>
      formatHistoryMessage(message, safeStart + offset)
    );

  const header = `Messages [${safeStart}, ${safeEnd}) of ${total} (0 = oldest):`;
  const footer =
    'Now compact this into a short summary of the key facts, decisions, and ' +
    'open threads, and work from that summary going forward instead of ' +
    're-reading this range.';
  return {
    content: [header, '', ...lines, '', footer].join('\n'),
    isError: false,
  };
}

function formatHistoryMessage(message: ChatMessage, index: number): string {
  const label =
    message.role === 'tool' && message.name
      ? `tool:${message.name}`
      : message.role;
  let body = message.content ?? '';
  if (body.length > MAX_HISTORY_MESSAGE_LENGTH) {
    body =
      `${body.slice(0, MAX_HISTORY_MESSAGE_LENGTH)}… ` +
      `[truncated: ${body.length} chars total]`;
  }
  const toolCalls = message.toolCalls?.length
    ? ` (requested: ${message.toolCalls.map((call) => call.name).join(', ')})`
    : '';
  return `#${index} [${label}]${toolCalls}\n${body}`;
}

function clampIndex(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
