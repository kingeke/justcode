import { describe, expect, it } from 'vitest';

import { HostMessageType } from '@ext/shared/protocol';
import { LocalActionType, initialState, reducer } from '@ext/webview/state';

describe('queued messages', () => {
  it('queues a message with its images and removes it by id', () => {
    let state = reducer(initialState, {
      type: LocalActionType.QueueMessage,
      content: 'follow up',
      images: [{ id: 'i1', mediaType: 'image/png', data: 'AAAA' }],
    });

    expect(state.queuedMessages).toHaveLength(1);
    const queued = state.queuedMessages[0]!;
    expect(queued.content).toBe('follow up');
    expect(queued.images).toHaveLength(1);

    state = reducer(state, {
      type: LocalActionType.DequeueMessage,
      id: queued.id,
    });
    expect(state.queuedMessages).toHaveLength(0);
  });

  it('edits a queued message in place', () => {
    let state = reducer(initialState, {
      type: LocalActionType.QueueMessage,
      content: 'origonal',
      images: [],
    });
    const id = state.queuedMessages[0]!.id;

    state = reducer(state, {
      type: LocalActionType.UpdateQueuedMessage,
      id,
      content: 'corrected',
    });

    expect(state.queuedMessages[0]!.content).toBe('corrected');
    // Editing keeps the same id and any attached images.
    expect(state.queuedMessages[0]!.id).toBe(id);
  });

  it('clears the queue', () => {
    let state = reducer(initialState, {
      type: LocalActionType.QueueMessage,
      content: 'a',
      images: [],
    });
    state = reducer(state, {
      type: LocalActionType.QueueMessage,
      content: 'b',
      images: [],
    });
    expect(state.queuedMessages).toHaveLength(2);

    state = reducer(state, { type: LocalActionType.ClearQueue });
    expect(state.queuedMessages).toHaveLength(0);
  });

  it('drops the queue when a fresh snapshot arrives', () => {
    let state = reducer(initialState, {
      type: LocalActionType.QueueMessage,
      content: 'pending',
      images: [],
    });

    state = reducer(state, {
      type: HostMessageType.Ready,
      providerId: 'p',
      activeModel: 'm',
      models: [],
      messages: [],
      autoApprove: false,
      expandTools: false,
      maxReadLines: 200,
      maxHistoryMessages: 50,
      thinkingCollapsed: false,
      localModelAutoRefresh: true,
      lazyToolLoading: true,
      manageableTools: [],
      disabledTools: [],
      reasoningEffortByModel: {},
      resolvedFiles: {},
      mcpLoading: false,
      modes: [],
      activeModeId: 'build',
      workspaceRoot: '/tmp/workspace',
    });

    expect(state.queuedMessages).toHaveLength(0);
  });
});
