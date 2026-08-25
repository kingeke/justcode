import { describe, expect, it } from 'vitest';

import { createConversation } from '@core/domain/conversation';
import { createMessage, MessageRole } from '@core/domain/message';
import { ProviderId } from '@core/ports/provider-catalog';
import { ChatBridge } from '@ext/host/chat-bridge';
import {
  HostMessageType,
  WebviewMessageType,
  type HostToWebview,
} from '@ext/shared/protocol';

/**
 * The bridge runs turns concurrently — one per session — and all turn-scoped
 * state lives on an ActiveTurn object keyed by session id. These tests drive
 * the private per-turn plumbing directly (no runtime services needed) to pin
 * down the cross-session isolation rules:
 *  - live turn output only reaches the webview while its session is viewed;
 *  - reopening the turn's session replays its recorded events and prompts;
 *  - Cancel stops the viewed session's turn only;
 *  - steering follow-ups steer the viewed session's turn only.
 */

// Minimal shape of the private ActiveTurn record (see chat-bridge.ts).
interface TestTurn {
  sessionId: string;
  abortController: AbortController;
  conversation: ReturnType<typeof createConversation>;
  pendingUserMessage: ReturnType<typeof createMessage>;
  liveTurnEvents: HostToWebview[];
  liveSubAgentRuns: Map<string, unknown>;
  steeringQueue: { id: string; content: string }[];
  startedAtMs: number;
  firstTokenAtMs: number | undefined;
  cumulativeUsage: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    cost: number;
  };
  costKnown: boolean;
  avgTokensPerSecond: number;
  completedTurnCount: number;
  lastInputTokens: number;
  lastTurnStats: undefined;
  pendingRequestIds: Set<string>;
  openPrompts: Map<string, HostToWebview>;
}

interface BridgeInternals {
  sessionId: string;
  conversation: ReturnType<typeof createConversation> | undefined;
  activeTurns: Map<string, TestTurn>;
  services: unknown;
  activeModel: string | undefined;
  models: unknown[];
  postTurn(turn: TestTurn, message: HostToWebview): void;
  postTurnPrompt(turn: TestTurn, prompt: HostToWebview): void;
  drainSteering(turn: TestTurn): string | null;
  replayLiveTurn(turn: TestTurn): void;
  resetSession(): Promise<void>;
  openSession(sessionId: string): Promise<void>;
}

/**
 * The minimal services stub the resetSession/openSession fast paths touch:
 * they reuse the cached provider/model state and only hit the session store.
 */
function stubServices(
  sessions: Array<{ sessionId: string; messageCount: number }>
): unknown {
  return {
    providerId: ProviderId.Ollama,
    allProviders: [],
    workspaceRoot: '/tmp',
    toolRegistry: { get: () => undefined },
    chatSessionService: {
      listSessions: async () =>
        sessions.map((s) => ({
          ...s,
          updatedAt: new Date().toISOString(),
        })),
      saveConversation: async () => {},
      loadConversation: async (sessionId: string) =>
        createConversation(sessionId),
    },
  };
}

function makeTurn(sessionId: string): TestTurn {
  return {
    sessionId,
    abortController: new AbortController(),
    conversation: createConversation(sessionId),
    pendingUserMessage: createMessage(
      MessageRole.User,
      'first message',
      new Date()
    ),
    liveTurnEvents: [],
    liveSubAgentRuns: new Map(),
    steeringQueue: [],
    startedAtMs: Date.now(),
    firstTokenAtMs: undefined,
    cumulativeUsage: {
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      cost: 0,
    },
    costKnown: false,
    avgTokensPerSecond: 0,
    completedTurnCount: 0,
    lastInputTokens: 0,
    lastTurnStats: undefined,
    pendingRequestIds: new Set(),
    openPrompts: new Map(),
  };
}

function makeBridge(posted: HostToWebview[]): BridgeInternals {
  const bridge = new ChatBridge((message) => posted.push(message), '/tmp');
  return bridge as unknown as BridgeInternals;
}

describe('cross-session turn isolation', () => {
  it('posts live turn output only while the turn session is viewed', () => {
    const posted: HostToWebview[] = [];
    const bridge = makeBridge(posted);
    const turn = makeTurn('session-a');
    bridge.activeTurns.set(turn.sessionId, turn);

    // Viewing another session: the background turn's output is suppressed.
    bridge.sessionId = 'session-b';
    bridge.postTurn(turn, { type: HostMessageType.Token, token: 'hidden' });
    expect(posted).toHaveLength(0);

    // Viewing the turn's session: output flows.
    bridge.sessionId = 'session-a';
    bridge.postTurn(turn, { type: HostMessageType.Token, token: 'shown' });
    expect(posted).toEqual([{ type: HostMessageType.Token, token: 'shown' }]);
  });

  it('parks approval prompts raised off-view and replays them on reopen', () => {
    const posted: HostToWebview[] = [];
    const bridge = makeBridge(posted);
    const turn = makeTurn('session-a');
    bridge.activeTurns.set(turn.sessionId, turn);

    const prompt: HostToWebview = {
      type: HostMessageType.ApprovalRequest,
      id: 'req-1',
      toolName: 'bash',
      view: { title: 'bash' },
    };
    bridge.sessionId = 'session-b';
    bridge.postTurnPrompt(turn, prompt);
    expect(posted).toHaveLength(0);
    expect([...turn.openPrompts.values()]).toEqual([prompt]);

    // Reopening the turn's session replays recorded events, then the prompt.
    turn.liveTurnEvents.push({ type: HostMessageType.Token, token: 'partial' });
    bridge.sessionId = 'session-a';
    bridge.replayLiveTurn(turn);
    expect(posted).toEqual([
      { type: HostMessageType.Token, token: 'partial' },
      prompt,
    ]);
  });

  it('re-poses a question the user navigated away from, until answered', async () => {
    const posted: HostToWebview[] = [];
    const bridge = makeBridge(posted);
    const turn = makeTurn('session-a');
    bridge.activeTurns.set(turn.sessionId, turn);

    // Question asked while the user is viewing the session: posted right away.
    const prompt: HostToWebview = {
      type: HostMessageType.UserInputRequest,
      id: 'q-1',
      questions: [
        {
          id: 'q1',
          question: 'Which database?',
          options: ['postgres', 'mysql'],
        },
      ],
    };
    bridge.sessionId = 'session-a';
    bridge.postTurnPrompt(turn, prompt);
    expect(posted).toEqual([prompt]);

    // The user wanders off and comes back: the still-unanswered question is
    // re-posed (reopening cleared the webview's prompt state).
    posted.length = 0;
    bridge.replayLiveTurn(turn);
    expect(posted).toEqual([prompt]);

    // Once answered, reopening no longer re-poses it.
    await (bridge as unknown as ChatBridge).handle({
      type: WebviewMessageType.UserInputResponse,
      id: 'q-1',
      answers: [{ id: 'q1', answer: 'postgres' }],
    });
    posted.length = 0;
    bridge.replayLiveTurn(turn);
    expect(posted).toEqual([]);
  });

  it('replays a live usage snapshot for an in-flight turn on reopen', () => {
    const posted: HostToWebview[] = [];
    const bridge = makeBridge(posted);
    const turn = makeTurn('session-a');
    turn.cumulativeUsage = {
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 0,
      cost: 0,
    };
    turn.lastInputTokens = 100;
    bridge.activeTurns.set(turn.sessionId, turn);
    bridge.sessionId = 'session-a';

    bridge.replayLiveTurn(turn);
    expect(posted).toEqual([
      {
        type: HostMessageType.UsageUpdate,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cachedTokens: 0,
          lastInputTokens: 100,
        },
      },
    ]);
  });

  it('cancels only the viewed session turn', async () => {
    const posted: HostToWebview[] = [];
    const bridge = makeBridge(posted);
    const turnA = makeTurn('session-a');
    const turnB = makeTurn('session-b');
    bridge.activeTurns.set(turnA.sessionId, turnA);
    bridge.activeTurns.set(turnB.sessionId, turnB);
    bridge.sessionId = 'session-b';

    await (bridge as unknown as ChatBridge).handle({
      type: WebviewMessageType.Cancel,
    });

    expect(turnB.abortController.signal.aborted).toBe(true);
    expect(turnA.abortController.signal.aborted).toBe(false);
  });

  it('steers only the viewed session turn', async () => {
    const posted: HostToWebview[] = [];
    const bridge = makeBridge(posted);
    const turnA = makeTurn('session-a');
    const turnB = makeTurn('session-b');
    bridge.activeTurns.set(turnA.sessionId, turnA);
    bridge.activeTurns.set(turnB.sessionId, turnB);
    bridge.sessionId = 'session-a';

    await (bridge as unknown as ChatBridge).handle({
      type: WebviewMessageType.SyncSteeringQueue,
      messages: [{ id: 'q1', content: 'also do this' }],
    });

    expect(turnA.steeringQueue).toEqual([
      { id: 'q1', content: 'also do this' },
    ]);
    expect(turnB.steeringQueue).toEqual([]);
  });

  it('records a consumed steering message so reopening the session replays it', () => {
    const posted: HostToWebview[] = [];
    const bridge = makeBridge(posted);
    const turn = makeTurn('session-a');
    bridge.activeTurns.set(turn.sessionId, turn);
    bridge.sessionId = 'session-a';
    turn.steeringQueue = [{ id: 'q1', content: 'also do this' }];

    const drained = bridge.drainSteering(turn);

    expect(drained).toBe('also do this');
    expect(turn.steeringQueue).toEqual([]);
    // Posted live *and* recorded, so a replay after navigating away and back
    // still shows the steering message.
    expect(
      posted.filter((m) => m.type === HostMessageType.SteeringConsumed)
    ).toHaveLength(1);
    expect(turn.liveTurnEvents).toEqual([
      {
        type: HostMessageType.SteeringConsumed,
        ids: ['q1'],
        content: 'also do this',
      },
    ]);

    posted.length = 0;
    bridge.replayLiveTurn(turn);
    expect(posted).toEqual([
      {
        type: HostMessageType.SteeringConsumed,
        ids: ['q1'],
        content: 'also do this',
      },
    ]);
  });

  it('never reuses a session with a running turn for a new chat', async () => {
    const posted: HostToWebview[] = [];
    const bridge = makeBridge(posted);
    const turn = makeTurn('session-a');
    bridge.activeTurns.set(turn.sessionId, turn);

    // Mid-first-turn the host's conversation still shows 0 messages, so it
    // *looks* empty — and the sessions list reports it as empty too. Neither
    // path may hand its id to the new chat.
    bridge.sessionId = 'session-a';
    bridge.conversation = createConversation('session-a');
    bridge.services = stubServices([
      { sessionId: 'session-a', messageCount: 0 },
    ]);
    bridge.activeModel = 'test-model';
    bridge.models = [
      { id: 'test-model', displayName: 'Test', providerId: ProviderId.Ollama },
    ];

    await bridge.resetSession();

    expect(bridge.sessionId).not.toBe('session-a');
    const ready = posted.find((m) => m.type === HostMessageType.Ready);
    expect(ready).toBeDefined();
    expect((ready as { sessionId: string }).sessionId).not.toBe('session-a');
  });

  it('shows the pending user message when reopening a session mid-turn', async () => {
    const posted: HostToWebview[] = [];
    const bridge = makeBridge(posted);
    const turn = makeTurn('session-a');
    bridge.activeTurns.set(turn.sessionId, turn);

    // The disk copy (loadConversation) is empty — the service hasn't saved the
    // prompt yet. Reopening must render the turn's pending user message anyway.
    bridge.sessionId = 'session-b';
    bridge.services = stubServices([]);
    bridge.activeModel = 'test-model';
    bridge.models = [
      { id: 'test-model', displayName: 'Test', providerId: ProviderId.Ollama },
    ];

    await bridge.openSession('session-a');

    const ready = posted.find((m) => m.type === HostMessageType.Ready) as
      | { messages: Array<{ role: string; content: string }>; busy?: boolean }
      | undefined;
    expect(ready).toBeDefined();
    expect(ready?.busy).toBe(true);
    expect(ready?.messages).toEqual([
      expect.objectContaining({ content: 'first message' }),
    ]);
  });
});
