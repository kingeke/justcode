import { describe, expect, it } from 'vitest';

import { HostMessageType, ToolPhase, WebviewRole } from '@ext/shared/protocol';
import {
  LiveTurnItemKind,
  LocalActionType,
  initialState,
  reducer,
} from '@ext/webview/state';

describe('webview chat state live turn ordering', () => {
  it('keeps thinking, assistant text, and tools in arrival order during a turn', () => {
    const withThinking = reducer(initialState, {
      type: HostMessageType.Thinking,
      token: 'thinking first',
    });

    const withStreaming = reducer(withThinking, {
      type: HostMessageType.Token,
      token: 'answer before tool',
    });

    const withTool = reducer(withStreaming, {
      type: HostMessageType.ToolActivity,
      phase: ToolPhase.Start,
      toolName: 'read_file',
      toolCallId: 'call-1',
      view: { title: 'Read file' },
    });

    expect(withTool.liveTurnItems).toEqual([
      expect.objectContaining({
        kind: LiveTurnItemKind.Thinking,
        content: 'thinking first',
      }),
      expect.objectContaining({
        kind: LiveTurnItemKind.Message,
        content: 'answer before tool',
      }),
      expect.objectContaining({
        kind: LiveTurnItemKind.Tool,
        toolCallId: 'call-1',
      }),
    ]);
    expect(withTool.thinking).toBe('');
    expect(withTool.streaming).toBe('');
  });

  it('stores persisted assistant thinking received from the host', () => {
    const completed = reducer(initialState, {
      type: HostMessageType.TurnComplete,
      messages: [
        { id: 'user-1', role: WebviewRole.User, content: 'hello' },
        {
          id: 'assistant-1',
          role: WebviewRole.Assistant,
          content: 'hi',
          thinking: { content: 'hidden reasoning', durationMs: 42 },
        },
      ],
    });

    expect(completed.messages[1]?.thinking).toEqual({
      content: 'hidden reasoning',
      durationMs: 42,
    });
  });

  it('keeps the partial thinking and answer visible when a turn is aborted', () => {
    const withThinking = reducer(initialState, {
      type: HostMessageType.Thinking,
      token: 'partial reasoning',
    });
    const withStreaming = reducer(withThinking, {
      type: HostMessageType.Token,
      token: 'partial answer',
    });

    const aborted = reducer(withStreaming, {
      type: HostMessageType.Error,
      message: 'Request cancelled.',
      aborted: true,
    });

    expect(aborted.busy).toBe(false);
    expect(aborted.liveTurnItems).toEqual([
      expect.objectContaining({
        kind: LiveTurnItemKind.Thinking,
        content: 'partial reasoning',
      }),
      expect.objectContaining({
        kind: LiveTurnItemKind.Message,
        content: 'partial answer',
      }),
    ]);
    // The transient buffers are drained into the committed items, not dropped.
    expect(aborted.thinking).toBe('');
    expect(aborted.streaming).toBe('');
  });

  it('does not flush live buffers on a non-abort error', () => {
    const withStreaming = reducer(initialState, {
      type: HostMessageType.Token,
      token: 'half a sentence',
    });

    const failed = reducer(withStreaming, {
      type: HostMessageType.Error,
      message: 'Something broke',
    });

    expect(failed.liveTurnItems).toEqual([]);
    expect(failed.streaming).toBe('half a sentence');
  });

  it('preserves completed thinking before the final assistant message', () => {
    const withThinking = reducer(initialState, {
      type: HostMessageType.Thinking,
      token: 'hidden reasoning',
    });

    const completed = reducer(withThinking, {
      type: HostMessageType.TurnComplete,
      messages: [
        { id: 'user-1', role: WebviewRole.User, content: 'hello' },
        { id: 'assistant-1', role: WebviewRole.Assistant, content: 'hi' },
      ],
    });

    expect(completed.completedThinkingItems).toEqual([
      expect.objectContaining({
        kind: LiveTurnItemKind.Thinking,
        content: 'hidden reasoning',
      }),
    ]);
    expect(completed.liveTurnItems).toEqual([]);
    expect(completed.thinking).toBe('');
  });

  it('scraps everything after the retried message and marks the turn busy', () => {
    const withHistory = reducer(initialState, {
      type: HostMessageType.TurnComplete,
      messages: [
        { id: 'user-1', role: WebviewRole.User, content: 'first' },
        { id: 'assistant-1', role: WebviewRole.Assistant, content: 'reply 1' },
        { id: 'user-2', role: WebviewRole.User, content: 'second' },
        { id: 'assistant-2', role: WebviewRole.Assistant, content: 'reply 2' },
      ],
    });

    const retried = reducer(withHistory, {
      type: LocalActionType.OptimisticRetry,
      messageId: 'user-2',
    });

    // The retried message stays visible as the optimistic echo; everything
    // after it is gone and the turn is running.
    expect(retried.messages.map((m) => m.id)).toEqual([
      'user-1',
      'assistant-1',
      'user-2',
    ]);
    expect(retried.busy).toBe(true);
    expect(retried.liveTurnItems).toEqual([]);
    expect(retried.streaming).toBe('');
  });

  it('replaces the edited message with the new content and scraps the tail', () => {
    const withHistory = reducer(initialState, {
      type: HostMessageType.TurnComplete,
      messages: [
        { id: 'user-1', role: WebviewRole.User, content: 'first' },
        { id: 'assistant-1', role: WebviewRole.Assistant, content: 'reply 1' },
        { id: 'user-2', role: WebviewRole.User, content: 'second' },
        { id: 'assistant-2', role: WebviewRole.Assistant, content: 'reply 2' },
      ],
    });

    const edited = reducer(withHistory, {
      type: LocalActionType.OptimisticEdit,
      messageId: 'user-2',
      content: 'second, but better',
      images: [],
    });

    expect(edited.messages.map((m) => m.content)).toEqual([
      'first',
      'reply 1',
      'second, but better',
    ]);
    // The replacement is a fresh optimistic echo, not the old committed id.
    expect(edited.messages[2]?.id).toMatch(/^local-/);
    expect(edited.busy).toBe(true);
  });

  it('ignores a retry for an unknown message id', () => {
    const withHistory = reducer(initialState, {
      type: HostMessageType.TurnComplete,
      messages: [{ id: 'user-1', role: WebviewRole.User, content: 'first' }],
    });

    const retried = reducer(withHistory, {
      type: LocalActionType.OptimisticRetry,
      messageId: 'missing',
    });

    expect(retried).toBe(withHistory);
  });
});
