import { describe, expect, it } from 'vitest';

import {
  HostMessageType,
  WebviewRole,
  WebviewSubAgentPhase,
  WebviewSubAgentStatus,
  type SubAgentActivityMessage,
} from '@ext/shared/protocol';
import {
  initialState,
  LocalActionType,
  reducer,
  type ChatState,
} from '@ext/webview/state';

function activity(
  overrides: Partial<SubAgentActivityMessage> = {}
): SubAgentActivityMessage {
  return {
    type: HostMessageType.SubAgentActivity,
    phase: WebviewSubAgentPhase.Start,
    runId: 'run-1',
    agentType: 'general',
    description: 'Build the CSS',
    ...overrides,
  };
}

describe('sub agent activity state', () => {
  it('adds a running entry on start and updates it on progress', () => {
    let state: ChatState = reducer(initialState, activity());
    expect(state.subAgents).toHaveLength(1);
    expect(state.subAgents[0]?.status).toBe(WebviewSubAgentStatus.Running);

    state = reducer(
      state,
      activity({
        phase: WebviewSubAgentPhase.Progress,
        toolUseCount: 3,
        latestActivity: 'write_file styles.css',
      })
    );
    expect(state.subAgents).toHaveLength(1);
    expect(state.subAgents[0]?.toolUseCount).toBe(3);
    expect(state.subAgents[0]?.latestActivity).toBe('write_file styles.css');
  });

  it('marks the run finished with its report on end', () => {
    let state: ChatState = reducer(initialState, activity());
    state = reducer(
      state,
      activity({
        phase: WebviewSubAgentPhase.End,
        status: WebviewSubAgentStatus.Completed,
        toolUseCount: 5,
        summary: 'Created styles.css with the agreed classes.',
      })
    );
    expect(state.subAgents[0]?.status).toBe(WebviewSubAgentStatus.Completed);
    expect(state.subAgents[0]?.summary).toContain('styles.css');
    expect(state.subAgents[0]?.endedAt).toBeDefined();
  });

  it("carries the run's usage and stats through the end event", () => {
    let state: ChatState = reducer(initialState, activity());
    state = reducer(
      state,
      activity({
        phase: WebviewSubAgentPhase.End,
        status: WebviewSubAgentStatus.Completed,
        usage: {
          inputTokens: 200,
          outputTokens: 40,
          cachedTokens: 5,
          cost: 0.02,
        },
        stats: {
          lastInputTokens: 200,
          ttftMs: 350,
          avgTokensPerSecond: 22.5,
        },
      })
    );
    expect(state.subAgents[0]?.usage?.cost).toBe(0.02);
    expect(state.subAgents[0]?.usage?.inputTokens).toBe(200);
    expect(state.subAgents[0]?.stats?.lastInputTokens).toBe(200);
    expect(state.subAgents[0]?.stats?.avgTokensPerSecond).toBe(22.5);
  });

  it('stores a fetched transcript by run id and replaces it on refresh', () => {
    let state: ChatState = reducer(initialState, activity());
    state = reducer(state, {
      type: HostMessageType.SubAgentTranscript,
      runId: 'run-1',
      messages: [
        { id: 'm1', role: WebviewRole.User, content: 'Build the CSS' },
      ],
    });
    expect(state.subAgentTranscripts['run-1']).toHaveLength(1);

    state = reducer(state, {
      type: HostMessageType.SubAgentTranscript,
      runId: 'run-1',
      messages: [
        { id: 'm1', role: WebviewRole.User, content: 'Build the CSS' },
        { id: 'm2', role: WebviewRole.Assistant, content: 'Done.' },
      ],
    });
    expect(state.subAgentTranscripts['run-1']).toHaveLength(2);
    expect(state.subAgentTranscripts['run-1']?.[1]?.content).toBe('Done.');
  });

  it('seeds persisted session runs from the Ready snapshot', () => {
    const state = reducer(initialState, {
      type: HostMessageType.Ready,
      sessionId: 's1',
      providerId: 'p',
      activeModel: 'm',
      models: [],
      messages: [],
      autoApprove: false,
      expandTools: false,
      maxReadLines: 200,
      videoFrameCount: 8,
      maxHistoryMessages: 50,
      autoCompactThresholdPercent: 80,
      thinkingCollapsed: false,
      localModelAutoRefresh: true,
      modelAutoRefresh: true,
      lazyToolLoading: true,
      manageableTools: [],
      disabledTools: [],
      reasoningEffortByModel: {},
      resolvedFiles: {},
      mcpLoading: false,
      modes: [],
      activeModeId: 'build',
      modelDefaults: { byMode: {}, bySubAgent: {} },
      workspaceRoot: '/tmp/workspace',
      subAgents: [
        {
          runId: 'run-1',
          agentType: 'general',
          description: 'Build the CSS',
          status: WebviewSubAgentStatus.Completed,
          toolUseCount: 4,
          summary: 'Created styles.css',
          startedAt: 1000,
          endedAt: 5000,
        },
      ],
    });
    expect(state.sessionSubAgents).toHaveLength(1);
    expect(state.sessionSubAgents[0]?.runId).toBe('run-1');
    expect(state.sessionSubAgents[0]?.status).toBe(
      WebviewSubAgentStatus.Completed
    );
    // Live-turn runs start empty; the persisted ones live separately.
    expect(state.subAgents).toHaveLength(0);
  });

  it('tracks multiple concurrent runs independently', () => {
    let state: ChatState = reducer(initialState, activity({ runId: 'run-1' }));
    state = reducer(state, activity({ runId: 'run-2', description: 'JS' }));
    state = reducer(
      state,
      activity({
        runId: 'run-1',
        phase: WebviewSubAgentPhase.End,
        status: WebviewSubAgentStatus.Failed,
      })
    );
    expect(state.subAgents).toHaveLength(2);
    expect(state.subAgents[0]?.status).toBe(WebviewSubAgentStatus.Failed);
    expect(state.subAgents[1]?.status).toBe(WebviewSubAgentStatus.Running);
  });

  it('retires finished runs to the session list when a new turn starts', () => {
    // A turn ran a sub agent to completion…
    let state: ChatState = reducer(initialState, activity());
    state = reducer(
      state,
      activity({
        phase: WebviewSubAgentPhase.End,
        status: WebviewSubAgentStatus.Completed,
        summary: 'done',
      })
    );

    // …then the user sends a new message: the live list clears, but the run
    // must move to the session list so the floating robot button keeps it.
    state = reducer(state, {
      type: LocalActionType.OptimisticSubmit,
      content: 'next question',
      images: [],
    });

    expect(state.subAgents).toHaveLength(0);
    expect(state.sessionSubAgents.map((run) => run.runId)).toContain('run-1');
    expect(
      state.sessionSubAgents.find((r) => r.runId === 'run-1')?.status
    ).toBe(WebviewSubAgentStatus.Completed);
  });
});
