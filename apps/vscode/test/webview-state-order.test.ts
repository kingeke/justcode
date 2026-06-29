import { describe, expect, it } from 'vitest';

import { HostMessageType, ToolPhase, WebviewRole } from '@ext/shared/protocol';
import { LiveTurnItemKind, initialState, reducer } from '@ext/webview/state';

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
});
