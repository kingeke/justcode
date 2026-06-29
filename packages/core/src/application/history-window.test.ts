import { describe, expect, it } from 'vitest';
import {
  MAX_HISTORY_WINDOW,
  renderHistoryWindow,
  selectRecentMessages,
} from '@core/application/history-window';
import { createMessage, type ChatMessage } from '@core/domain/message';

function user(content: string): ChatMessage {
  return createMessage('user', content);
}

function assistant(content: string): ChatMessage {
  return createMessage('assistant', content);
}

function toolResult(content: string, callId = 'call-1'): ChatMessage {
  return createMessage('tool', content, new Date(), undefined, {
    toolCallId: callId,
    name: 'read_file',
  });
}

describe('selectRecentMessages', () => {
  it('returns all messages when the count is within the limit', () => {
    const messages = [user('a'), assistant('b')];
    expect(selectRecentMessages(messages, 50)).toBe(messages);
  });

  it('returns everything when the limit is non-positive (off)', () => {
    const messages = [user('a'), assistant('b'), user('c')];
    expect(selectRecentMessages(messages, 0)).toBe(messages);
    expect(selectRecentMessages(messages, -5)).toBe(messages);
  });

  it('keeps only the most recent messages up to the limit', () => {
    const messages = [user('a'), assistant('b'), user('c'), assistant('d')];
    const result = selectRecentMessages(messages, 2);
    expect(result.map((m) => m.content)).toEqual(['c', 'd']);
  });

  it('never starts the window on an orphaned tool result', () => {
    // Limit 2 would land on the tool result whose assistant call was trimmed;
    // the window must advance past it so the provider never sees a dangling tool.
    const messages = [
      user('a'),
      assistant('calls tool'),
      toolResult('tool output'),
      assistant('final'),
    ];
    const result = selectRecentMessages(messages, 2);
    expect(result.map((m) => m.role)).toEqual(['assistant']);
    expect(result[0]?.content).toBe('final');
  });
});

describe('renderHistoryWindow', () => {
  it('reports when there is no history', () => {
    const result = renderHistoryWindow([], 0);
    expect(result.isError).toBe(false);
    expect(result.content).toContain('No conversation history');
  });

  it('renders the requested window with indices and roles', () => {
    const messages = [user('first'), assistant('second'), user('third')];
    const result = renderHistoryWindow(messages, 0, 2);
    expect(result.isError).toBe(false);
    expect(result.content).toContain('#0 [user]');
    expect(result.content).toContain('first');
    expect(result.content).toContain('#1 [assistant]');
    expect(result.content).not.toContain('third');
  });

  it('flags an out-of-range request instead of throwing', () => {
    const messages = [user('only')];
    const result = renderHistoryWindow(messages, 5, 9);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('1 message');
  });

  it('caps the window to MAX_HISTORY_WINDOW messages', () => {
    const messages = Array.from({ length: MAX_HISTORY_WINDOW + 20 }, (_, i) =>
      user(`m${i}`)
    );
    const result = renderHistoryWindow(messages, 0);
    const rendered = result.content
      .split('\n')
      .filter((line) => line.startsWith('#')).length;
    expect(rendered).toBe(MAX_HISTORY_WINDOW);
  });
});
