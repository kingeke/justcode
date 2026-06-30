import { describe, expect, it } from 'vitest';

import {
  HostMessageType,
  ToolPhase,
  WebviewRole,
  type WebviewMessage,
} from '@ext/shared/protocol';
import { initialState, reducer, type ChatState } from '@ext/webview/state';
import { deriveChangedFiles } from '@ext/webview/changes';

/** What the changes panel would render for a given state. */
function panelPaths(state: ChatState): string[] {
  const resolved = new Map(Object.entries(state.resolvedFiles));
  return deriveChangedFiles(state.messages, state.tools, resolved).map(
    (file) => file.path
  );
}

describe('deletion persistence through a turn', () => {
  it('keeps a bash deletion in the panel after the turn completes', () => {
    let state = reducer(initialState, {
      type: HostMessageType.Ready,
      providerId: 'p',
      activeModel: 'm',
      models: [],
      messages: [],
      autoApplyWrites: true,
      expandTools: false,
      maxReadLines: 200,
      maxHistoryMessages: 50,
      thinkingCollapsed: false,
      localModelAutoRefresh: true,
      reasoningEffortByModel: {},
      resolvedFiles: {},
    });

    state = reducer(state, {
      type: HostMessageType.ToolActivity,
      phase: ToolPhase.Start,
      toolName: 'bash',
      toolCallId: 'b1',
      view: { title: 'bash: rm gone.ts', preview: 'rm gone.ts' },
    });

    // The deletion diff only materializes on `end` (once the file is gone).
    state = reducer(state, {
      type: HostMessageType.ToolActivity,
      phase: ToolPhase.End,
      toolName: 'bash',
      toolCallId: 'b1',
      view: {
        title: 'bash: rm gone.ts',
        preview: 'rm gone.ts',
        diff: { path: 'gone.ts', oldText: 'content\n', newText: '' },
      },
      isError: false,
    });

    // Live: shows during the turn.
    expect(panelPaths(state)).toEqual(['gone.ts']);

    // The host rebuilds the transcript with the diff cached onto the bash tool
    // message, so the committed snapshot carries it too.
    const committed: WebviewMessage[] = [
      { id: 'u', role: WebviewRole.User, content: 'delete it' },
      {
        id: 't',
        role: WebviewRole.Tool,
        content: 'deleted',
        toolName: 'bash',
        toolView: {
          title: 'bash: rm gone.ts',
          diff: { path: 'gone.ts', oldText: 'content\n', newText: '' },
        },
      },
    ];

    state = reducer(state, {
      type: HostMessageType.TurnComplete,
      messages: committed,
    });

    // Committed: still shows after the turn — no flash-then-vanish.
    expect(panelPaths(state)).toEqual(['gone.ts']);
  });
});
