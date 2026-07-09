import { describe, expect, it } from 'vitest';
import {
  ChatSessionService,
  describeTool,
  getInterruptedConversation,
} from '@core/application/chat-session-service';
import { ToolRegistry } from '@core/application/tool-registry';
import { createConversation } from '@core/domain/conversation';
import { createMessage, MessageRole } from '@core/domain/message';
import {
  ReasoningEffort,
  ToolsUnsupportedError,
  type ChatRequest,
  type ChatResult,
  type ProviderClient,
} from '@core/ports/chat-model';
import { ProviderId } from '@core/ports/provider-catalog';
import type { ConversationRepository } from '@core/ports/conversation-repository';
import type { Tool, ToolExecutionContext } from '@core/ports/tool';
import {
  SubAgentActivityPhase,
  SubAgentRunStatus,
  SubAgentType,
  type SubAgentActivityEvent,
} from '@core/domain/sub-agent';
import { LazyLoadToolsTool } from '@runtime/tools/lazy-load-tools-tool';
import type { WorkspaceFilePort } from '@core/ports/workspace-file-port';
import {
  COMPACT_CONTINUATION_HEADER,
  DEFAULT_COMPACT_PROMPT,
} from '@core/application/compact-prompt';

class InMemoryConversationRepository implements ConversationRepository {
  public conversation = createConversation('session-1');
  public sessions = [
    {
      sessionId: this.conversation.sessionId,
      createdAt: this.conversation.createdAt,
      updatedAt: this.conversation.updatedAt,
      messageCount: this.conversation.messages.length,
    },
  ];

  public async load(
    _sessionId: string
  ): Promise<ReturnType<typeof createConversation>> {
    return this.conversation;
  }

  public async save(
    conversation: ReturnType<typeof createConversation>
  ): Promise<void> {
    this.conversation = conversation;
  }

  public async clear(_sessionId: string): Promise<void> {
    this.conversation = createConversation(_sessionId);
  }

  public async list() {
    return this.sessions;
  }
}

class InMemoryWorkspaceFiles implements WorkspaceFilePort {
  public constructor(private readonly files: Record<string, string>) {}

  public async listFiles(): Promise<string[]> {
    return Object.keys(this.files);
  }

  public async readFile(relativePath: string): Promise<string> {
    const content = this.files[relativePath];
    if (content === undefined) {
      throw new Error(`File '${relativePath}' was not found.`);
    }

    return content;
  }

  public async readFileBytes(relativePath: string): Promise<Uint8Array> {
    return Buffer.from(await this.readFile(relativePath), 'utf8');
  }

  public async writeFile(relativePath: string, content: string): Promise<void> {
    this.files[relativePath] = content;
  }
}

/**
 * A conversation that already carries a title, so background title generation is
 * skipped. Tests that record the turn's sendChat calls by order use this to keep
 * the (separately fired) title request out of the recorded sequence. Titling
 * itself is covered by the dedicated title tests.
 */
function titledConversation(
  sessionId: string
): ReturnType<typeof createConversation> {
  return { ...createConversation(sessionId), title: 'Session Title' };
}

function createProviderStub(): ProviderClient {
  return {
    providerId: ProviderId.Ollama,
    async sendChat({ messages }) {
      const latestMessage = messages[messages.length - 1];
      return { content: `reply:${latestMessage?.content ?? ''}` };
    },
    async listModels() {
      return [
        {
          id: 'llama3.1',
          displayName: 'llama3.1',
          providerId: ProviderId.Ollama,
        },
      ];
    },
    getDefaultModel() {
      return undefined;
    },
  };
}

class RecordingWriteTool implements Tool {
  public readonly executed: string[] = [];
  public readonly requiresApproval = true;
  public readonly definition = {
    name: 'write_file',
    description: 'writes a file',
    parameters: { type: 'object' },
  };

  public describe(rawArguments: string): { title: string; preview?: string } {
    return { title: 'write', preview: rawArguments };
  }

  public async execute(rawArguments: string): Promise<{ content: string }> {
    this.executed.push(rawArguments);
    return { content: 'wrote the file' };
  }
}

class PreviewingWriteTool extends RecordingWriteTool {
  public async previewDiff(): Promise<{
    path: string;
    oldText: string;
    newText: string;
  }> {
    return {
      path: 'a.txt',
      oldText: 'before',
      newText: 'after',
    };
  }
}

/** Returns a tool call on the first turn, then a final answer. */
function createToolCallingProvider(
  toolName = 'write_file',
  toolArguments?: string
): ProviderClient {
  let turn = 0;
  return {
    providerId: ProviderId.Openai,
    async sendChat(): Promise<ChatResult> {
      turn += 1;
      if (turn === 1) {
        return {
          content: '',
          toolCalls: [
            {
              id: 'call-1',
              name: toolName,
              arguments: toolArguments ?? '{"path":"a.txt","content":"hi"}',
            },
          ],
        };
      }
      return { content: 'All done.' };
    },
    async listModels() {
      return [{ id: 'gpt', displayName: 'gpt', providerId: ProviderId.Openai }];
    },
    getDefaultModel() {
      return 'gpt';
    },
  };
}

function createAbortableProvider(): ProviderClient {
  return {
    providerId: ProviderId.Ollama,
    async sendChat({ signal }: ChatRequest): Promise<ChatResult> {
      return await new Promise<ChatResult>((_resolve, reject) => {
        const abort = (): void => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        };

        if (signal?.aborted) {
          abort();
          return;
        }

        signal?.addEventListener('abort', abort, { once: true });
      });
    },
    async listModels() {
      return [
        {
          id: 'llama3.1',
          displayName: 'llama3.1',
          providerId: ProviderId.Ollama,
        },
      ];
    },
    getDefaultModel() {
      return undefined;
    },
  };
}

function createTitleGeneratingProvider(): ProviderClient {
  return {
    providerId: ProviderId.Ollama,
    async sendChat({ messages }): Promise<ChatResult> {
      // The title call is fired before the main turn, so identify it by its
      // wrapped user message rather than call order.
      const isTitleCall = messages.some(
        (message) =>
          message.role === 'user' && message.content.includes('<message>')
      );
      if (isTitleCall) {
        expect(messages.map((message) => message.role)).toEqual([
          'system',
          'user',
        ]);
        return { content: 'Project Planning' };
      }

      return { content: 'reply:Hello there' };
    },
    async listModels() {
      return [
        {
          id: 'llama3.1',
          displayName: 'llama3.1',
          providerId: ProviderId.Ollama,
        },
      ];
    },
    getDefaultModel() {
      return undefined;
    },
  };
}

/** A stub `task`-style tool that records and reports a sub agent run. */
class SubAgentRecordingTool implements Tool {
  public readonly requiresApproval = false;
  public receivedModel: string | undefined;
  public receivedToolCallId: string | undefined;
  public readonly definition = {
    name: 'task',
    description: 'delegates a task',
    parameters: { type: 'object' },
  };

  public describe(): { title: string } {
    return { title: 'task' };
  }

  public async execute(
    _rawArguments: string,
    context: ToolExecutionContext
  ): Promise<{ content: string }> {
    this.receivedModel = context.model;
    this.receivedToolCallId = context.toolCallId;
    context.recordSubAgentRun?.({
      id: context.toolCallId ?? 'run-1',
      agentType: SubAgentType.Explorer,
      description: 'Find the bug',
      prompt: 'find it',
      status: SubAgentRunStatus.Completed,
      messages: [],
      startedAt: new Date().toISOString(),
      summary: 'found it',
    });
    context.onSubAgentActivity?.({
      phase: SubAgentActivityPhase.End,
      runId: context.toolCallId ?? 'run-1',
      agentType: SubAgentType.Explorer,
      description: 'Find the bug',
      status: SubAgentRunStatus.Completed,
    });
    return { content: 'found it' };
  }
}

describe('ChatSessionService', () => {
  it('runs multiple task calls in the same batch concurrently', async () => {
    const repository = new InMemoryConversationRepository();
    // A task tool whose two executions overlap only if they run in parallel:
    // each records its start, then waits until both have started.
    let started = 0;
    let releaseAll: (() => void) | undefined;
    const bothStarted = new Promise<void>((resolve) => {
      releaseAll = () => resolve();
    });
    const tool: Tool = {
      requiresApproval: false,
      definition: {
        name: 'task',
        description: 'delegates',
        parameters: { type: 'object' },
      },
      describe: () => ({ title: 'task' }),
      execute: async () => {
        started += 1;
        if (started === 2) releaseAll?.();
        await bothStarted;
        return { content: 'done' };
      },
    };
    let turn = 0;
    const provider: ProviderClient = {
      providerId: ProviderId.Openai,
      async sendChat(): Promise<ChatResult> {
        turn += 1;
        if (turn === 1) {
          return {
            content: '',
            toolCalls: [
              { id: 'call-1', name: 'task', arguments: '{}' },
              { id: 'call-2', name: 'task', arguments: '{}' },
            ],
          };
        }
        return { content: 'All done.' };
      },
      async listModels() {
        return [];
      },
      getDefaultModel() {
        return undefined;
      },
    };
    const service = new ChatSessionService(repository, provider, {
      toolRegistry: new ToolRegistry([tool]),
      getLazyToolLoadingEnabled: () => false,
    });

    const result = await service.submitMessage({
      conversation: titledConversation('session-1'),
      model: 'gpt',
      content: 'delegate twice',
    });

    // Sequential execution would deadlock (the first call waits forever for
    // the second to start); completing at all proves they ran concurrently.
    expect(result.reply).toBe('All done.');
    expect(started).toBe(2);
  });

  it('exposes the live provider after a runtime switch (getProvider)', () => {
    const repository = new InMemoryConversationRepository();
    const original: ProviderClient = {
      providerId: ProviderId.Openai,
      async sendChat(): Promise<ChatResult> {
        return { content: '' };
      },
      async listModels() {
        return [];
      },
      getDefaultModel() {
        return undefined;
      },
    };
    const replacement: ProviderClient = {
      ...original,
      providerId: ProviderId.Copilot,
    };
    const service = new ChatSessionService(repository, original, {});

    // Sub agents (the task tool) read the provider per run through this
    // getter; it must track a host's switchProvider, not the bootstrap client.
    expect(service.getProvider()).toBe(original);
    service.switchProvider(replacement);
    expect(service.getProvider()).toBe(replacement);
  });

  it('threads model, tool call id, and sub agent recording into tool execution', async () => {
    const repository = new InMemoryConversationRepository();
    const tool = new SubAgentRecordingTool();
    const events: SubAgentActivityEvent[] = [];
    const service = new ChatSessionService(
      repository,
      createToolCallingProvider('task', '{}'),
      {
        toolRegistry: new ToolRegistry([tool]),
        getLazyToolLoadingEnabled: () => false,
      }
    );

    const result = await service.submitMessage({
      conversation: titledConversation('session-1'),
      model: 'gpt',
      content: 'delegate this',
      onSubAgentActivity: (event) => events.push(event),
    });

    expect(tool.receivedModel).toBe('gpt');
    expect(tool.receivedToolCallId).toBe('call-1');
    expect(events).toHaveLength(1);
    expect(events[0]?.status).toBe(SubAgentRunStatus.Completed);
    // The run is persisted with the turn (and on the returned conversation).
    expect(result.conversation.subAgentRuns).toHaveLength(1);
    expect(result.conversation.subAgentRuns?.[0]?.summary).toBe('found it');
    expect(repository.conversation.subAgentRuns).toHaveLength(1);
  });

  it('loads available models and picks the first model when none is requested', async () => {
    const service = new ChatSessionService(
      new InMemoryConversationRepository(),
      createProviderStub()
    );

    const session = await service.startSession({ sessionId: 'session-1' });

    expect(session.activeModel).toBe('llama3.1');
    expect(session.availableModels).toEqual([
      {
        id: 'llama3.1',
        displayName: 'llama3.1',
        providerId: ProviderId.Ollama,
      },
    ]);
  });

  it('persists user and assistant messages to conversation history', async () => {
    const repository = new InMemoryConversationRepository();
    const service = new ChatSessionService(repository, createProviderStub());

    const startedSession = await service.startSession({
      sessionId: 'session-1',
    });
    const result = await service.submitMessage({
      conversation: startedSession.conversation,
      model: startedSession.activeModel,
      content: 'Hello',
    });

    expect(result.reply).toBe('reply:Hello');
    expect(result.conversation.messages).toHaveLength(2);
    expect(result.conversation.messages[0]?.role).toBe('user');
    expect(result.conversation.messages[1]?.role).toBe('assistant');
    expect(repository.conversation.messages).toHaveLength(2);
  });

  it('stamps the user message with the time the LLM received it', async () => {
    const repository = new InMemoryConversationRepository();
    const service = new ChatSessionService(repository, createProviderStub());

    const startedSession = await service.startSession({
      sessionId: 'session-1',
    });
    const before = Date.now();
    const result = await service.submitMessage({
      conversation: startedSession.conversation,
      model: startedSession.activeModel,
      content: 'Hello',
    });
    const after = Date.now();

    const userMessage = result.conversation.messages[0];
    expect(userMessage?.role).toBe('user');
    expect(userMessage?.llmReceivedAt).toBeDefined();
    const receivedMs = new Date(userMessage!.llmReceivedAt!).getTime();
    expect(receivedMs).toBeGreaterThanOrEqual(before);
    expect(receivedMs).toBeLessThanOrEqual(after);
    expect(receivedMs).toBeGreaterThanOrEqual(
      new Date(userMessage!.createdAt).getTime()
    );
    // The stamp rides on the persisted conversation too.
    expect(repository.conversation.messages[0]?.llmReceivedAt).toBe(
      userMessage?.llmReceivedAt
    );
    // The assistant reply carries the same instant: when the LLM received the
    // request that produced it, shown under the reply in the UIs.
    expect(result.conversation.messages[1]?.llmReceivedAt).toBe(
      userMessage?.llmReceivedAt
    );
  });

  it('preserves a title persisted out of band when a later turn saves', async () => {
    const repository = new InMemoryConversationRepository();
    const service = new ChatSessionService(repository, createProviderStub());

    const started = await service.startSession({ sessionId: 'session-1' });

    // Simulate background title generation (from a previous message) having
    // written a title to disk that the in-memory conversation doesn't carry.
    repository.conversation = {
      ...repository.conversation,
      title: 'Persisted Title',
    };

    await service.submitMessage({
      conversation: started.conversation, // no title in memory
      model: started.activeModel,
      content: 'second message',
    });

    // The save must keep the out-of-band title rather than wiping it.
    expect(repository.conversation.title).toBe('Persisted Title');
    expect(repository.conversation.messages).toHaveLength(2);
  });

  it('saves session stats onto the persisted conversation without touching messages', async () => {
    const repository = new InMemoryConversationRepository();
    const service = new ChatSessionService(repository, createProviderStub());

    const started = await service.startSession({ sessionId: 'session-1' });
    await service.submitMessage({
      conversation: started.conversation,
      model: started.activeModel,
      content: 'Hello',
    });

    await service.saveSessionStats('session-1', {
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 20,
      cost: 0.01,
      lastInputTokens: 100,
      ttftMs: 250,
      tokensPerSecond: 40,
      avgTokensPerSecond: 40,
      completedTurnCount: 1,
    });

    expect(repository.conversation.stats?.inputTokens).toBe(100);
    expect(repository.conversation.stats?.avgTokensPerSecond).toBe(40);
    expect(repository.conversation.stats?.completedTurnCount).toBe(1);
    expect(repository.conversation.messages).toHaveLength(2);
  });

  it('does not materialize an empty conversation just to hold stats', async () => {
    const repository = new InMemoryConversationRepository();
    const service = new ChatSessionService(repository, createProviderStub());

    await service.saveSessionStats('session-1', {
      inputTokens: 1,
      outputTokens: 1,
      cachedTokens: 0,
      cost: 0,
      lastInputTokens: 1,
    });

    expect(repository.conversation.stats).toBeUndefined();
  });

  it('persists assistant thinking with the assistant message', async () => {
    const repository = new InMemoryConversationRepository();
    const provider: ProviderClient = {
      providerId: ProviderId.Openai,
      async sendChat({ onThinkingToken }): Promise<ChatResult> {
        onThinkingToken?.('Thinking');
        onThinkingToken?.(' hard');
        return { content: 'Final answer.' };
      },
      async listModels() {
        return [
          { id: 'gpt', displayName: 'gpt', providerId: ProviderId.Openai },
        ];
      },
      getDefaultModel() {
        return 'gpt';
      },
    };
    const service = new ChatSessionService(repository, provider);

    const startedSession = await service.startSession({
      sessionId: 'session-1',
    });
    const streamedThinking: string[] = [];
    const result = await service.submitMessage({
      conversation: startedSession.conversation,
      model: startedSession.activeModel,
      content: 'Hello',
      onThinkingToken: (token) => streamedThinking.push(token),
    });

    expect(streamedThinking).toEqual(['Thinking', ' hard']);
    expect(result.conversation.messages[1]?.thinking?.content).toBe(
      'Thinking hard'
    );
    expect(repository.conversation.messages[1]?.thinking?.content).toBe(
      'Thinking hard'
    );
  });

  it('emits per-step usage via onUsage as the turn progresses', async () => {
    const repository = new InMemoryConversationRepository();
    const toolRegistry = new ToolRegistry([new RecordingWriteTool()]);
    // Returns a tool call (step 1) then a final answer (step 2); each step
    // reports its own usage.
    let turn = 0;
    const provider: ProviderClient = {
      providerId: ProviderId.Openai,
      async sendChat(): Promise<ChatResult> {
        turn += 1;
        if (turn === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'call-1', name: 'write_file', arguments: '{}' }],
            usage: { inputTokens: 10, outputTokens: 2, cachedTokens: 0 },
          };
        }
        return {
          content: 'All done.',
          usage: { inputTokens: 20, outputTokens: 5, cachedTokens: 1 },
        };
      },
      async listModels() {
        return [
          { id: 'gpt', displayName: 'gpt', providerId: ProviderId.Openai },
        ];
      },
      getDefaultModel() {
        return 'gpt';
      },
    };
    const service = new ChatSessionService(repository, provider, {
      toolRegistry,
    });

    const started = await service.startSession({ sessionId: 'session-1' });
    const usageEvents: number[] = [];
    const result = await service.submitMessage({
      conversation: { ...started.conversation, title: 'Session Title' },
      model: started.activeModel,
      content: 'Do the thing',
      requestApproval: async () => true,
      onUsage: (usage) => usageEvents.push(usage.inputTokens),
    });

    // One event per model response (not a single end-of-turn total).
    expect(usageEvents).toEqual([10, 20]);
    // The returned total still sums every step.
    expect(result.usage).toEqual({
      inputTokens: 30,
      outputTokens: 7,
      cachedTokens: 1,
    });
  });

  it("folds a tool's own usage (e.g. sub agents) into the turn's usage", async () => {
    const repository = new InMemoryConversationRepository();
    // A tool that itself spends tokens against the provider, like the task
    // tool's sub agents, reporting that spend on its ToolResult.
    const billingTool: Tool = {
      requiresApproval: false,
      definition: {
        name: 'task',
        description: 'delegates work',
        parameters: { type: 'object' },
      },
      describe: () => ({ title: 'task' }),
      execute: async () => ({
        content: 'sub agent report',
        usage: {
          inputTokens: 500,
          outputTokens: 100,
          cachedTokens: 0,
          cost: 0.05,
        },
      }),
    };
    const toolRegistry = new ToolRegistry([billingTool]);
    let turn = 0;
    const provider: ProviderClient = {
      providerId: ProviderId.Openai,
      async sendChat(): Promise<ChatResult> {
        turn += 1;
        if (turn === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'call-1', name: 'task', arguments: '{}' }],
            usage: { inputTokens: 10, outputTokens: 2, cachedTokens: 0 },
          };
        }
        return {
          content: 'All done.',
          usage: { inputTokens: 20, outputTokens: 5, cachedTokens: 0 },
        };
      },
      async listModels() {
        return [
          { id: 'gpt', displayName: 'gpt', providerId: ProviderId.Openai },
        ];
      },
      getDefaultModel() {
        return 'gpt';
      },
    };
    const service = new ChatSessionService(repository, provider, {
      toolRegistry,
    });

    const started = await service.startSession({ sessionId: 'session-1' });
    const usageEvents: number[] = [];
    const result = await service.submitMessage({
      conversation: { ...started.conversation, title: 'Session Title' },
      model: started.activeModel,
      content: 'Delegate the thing',
      requestApproval: async () => true,
      onUsage: (usage) => usageEvents.push(usage.inputTokens),
    });

    // The sub agent's usage (500) is surfaced live between the two model steps.
    expect(usageEvents).toEqual([10, 500, 20]);
    // ...and summed into the turn total (with its cost).
    expect(result.usage).toEqual({
      inputTokens: 530,
      outputTokens: 107,
      cachedTokens: 0,
      cost: 0.05,
    });
  });

  it('sends only the most recent messages when a history limit is set', async () => {
    const repository = new InMemoryConversationRepository();
    const receivedCounts: number[] = [];
    const provider: ProviderClient = {
      providerId: ProviderId.Ollama,
      async sendChat({ messages }): Promise<ChatResult> {
        // Exclude the always-present system message from the count.
        receivedCounts.push(messages.filter((m) => m.role !== 'system').length);
        return { content: 'ok' };
      },
      async listModels() {
        return [
          {
            id: 'llama3.1',
            displayName: 'llama3.1',
            providerId: ProviderId.Ollama,
          },
        ];
      },
      getDefaultModel() {
        return undefined;
      },
    };
    const service = new ChatSessionService(repository, provider, {
      getMaxHistoryMessages: () => 3,
    });

    const started = await service.startSession({ sessionId: 'session-1' });
    const conversation = {
      ...started.conversation,
      // Pre-set a title so background title generation doesn't issue its own
      // (separate) sendChat and pollute the recorded counts.
      title: 'Existing',
      messages: [
        createMessage(MessageRole.User, 'm1'),
        createMessage(MessageRole.Assistant, 'm2'),
        createMessage(MessageRole.User, 'm3'),
        createMessage(MessageRole.Assistant, 'm4'),
      ],
    };

    await service.submitMessage({
      conversation,
      model: started.activeModel,
      content: 'm5',
    });

    // 4 prior + the new user message = 5 working messages, trimmed to the last 3.
    expect(receivedCounts).toEqual([3]);
  });

  it('generates the session title with the first turn and saves it with it', async () => {
    const repository = new InMemoryConversationRepository();
    const service = new ChatSessionService(
      repository,
      createTitleGeneratingProvider()
    );

    const startedSession = await service.startSession({
      sessionId: 'session-1',
    });

    let deliveredTitle: string | undefined;
    const result = await service.submitMessage({
      conversation: startedSession.conversation,
      model: startedSession.activeModel,
      content: 'Hello there',
      onTitle: (_sessionId, title) => {
        deliveredTitle = title;
      },
    });

    // The title call is awaited before the main turn (folded into the first
    // message's wait), so the result already carries it and onTitle has fired.
    expect(deliveredTitle).toBe('Project Planning');
    expect(result.conversation.title).toBe('Project Planning');
    expect(repository.conversation.title).toBe('Project Planning');
  });

  it("disables reasoning for the title call, but not when the model's reasoning is mandatory", async () => {
    // The title call is identified by its wrapped <message> user content; the
    // reasoning effort each such call carries is recorded per scenario.
    const titleEfforts: Array<string | undefined> = [];
    const provider: ProviderClient = {
      providerId: ProviderId.Ollama,
      async sendChat({ messages, reasoningEffort }): Promise<ChatResult> {
        const isTitleCall = messages.some(
          (message) =>
            message.role === 'user' && message.content.includes('<message>')
        );
        if (isTitleCall) {
          titleEfforts.push(reasoningEffort);
          return { content: 'A Title' };
        }
        return { content: 'reply' };
      },
      async listModels() {
        return [
          {
            id: 'llama3.1',
            displayName: 'llama3.1',
            providerId: ProviderId.Ollama,
          },
        ];
      },
      getDefaultModel() {
        return undefined;
      },
    };
    // A fresh service and repository per scenario, so the first turn's saved
    // title can't be reused by the second and suppress its title call.
    // Reasoning turn on a model that can turn reasoning off: the title call
    // sends the explicit 'off' so it stays fast.
    await new ChatSessionService(
      new InMemoryConversationRepository(),
      provider
    ).submitMessage({
      conversation: createConversation('session-1'),
      model: 'llama3.1',
      reasoningEffort: ReasoningEffort.High,
      content: 'Hello there',
    });
    // Reasoning turn on a mandatory-reasoning model (e.g. OpenRouter's gpt-oss):
    // the wire-level disable would be rejected with a 400, so the title call
    // must omit the reasoning parameter entirely instead.
    await new ChatSessionService(
      new InMemoryConversationRepository(),
      provider
    ).submitMessage({
      conversation: createConversation('session-2'),
      model: 'llama3.1',
      reasoningEffort: ReasoningEffort.High,
      reasoningMandatory: true,
      content: 'Hello there',
    });

    expect(titleEfforts).toEqual(['off', undefined]);
  });

  it('frames the title request as data and sanitizes a runaway reply', async () => {
    const repository = new InMemoryConversationRepository();
    let titleUserMessage: string | undefined;
    const provider: ProviderClient = {
      providerId: ProviderId.Ollama,
      async sendChat({ messages }): Promise<ChatResult> {
        // The title call is fired before the main turn; identify it by its
        // wrapped user message rather than call order.
        const userContent = messages.find((m) => m.role === 'user')?.content;
        const isTitleCall = userContent?.includes('<message>') ?? false;
        if (!isTitleCall) {
          return { content: 'reply:sure' };
        }
        titleUserMessage = userContent;
        // Model ignored the prompt and answered with a markdown table.
        return {
          content: '| Category | Examples |\n|---|---|\n| Grains | Rice |',
        };
      },
      async listModels() {
        return [
          {
            id: 'llama3.1',
            displayName: 'llama3.1',
            providerId: ProviderId.Ollama,
          },
        ];
      },
      getDefaultModel() {
        return undefined;
      },
    };

    const service = new ChatSessionService(repository, provider);
    const startedSession = await service.startSession({ sessionId: 's1' });

    const title = await new Promise<string>((resolve) => {
      void service.submitMessage({
        conversation: startedSession.conversation,
        model: startedSession.activeModel,
        content: 'give me classifications of food in a table form',
        onTitle: (_sessionId, generated) => resolve(generated),
      });
    });

    // The first message is wrapped so the model treats it as data, not a request.
    expect(titleUserMessage).toContain(
      '<message>\ngive me classifications of food in a table form\n</message>'
    );
    // A table reply is reduced to its first line with markdown markers stripped.
    expect(title).toBe('Category | Examples');
  });

  it('lists saved sessions', async () => {
    const repository = new InMemoryConversationRepository();
    const service = new ChatSessionService(repository, createProviderStub());

    await expect(service.listSessions()).resolves.toEqual(repository.sessions);
  });

  it('renames a session, persisting the trimmed title', async () => {
    const repository = new InMemoryConversationRepository();
    repository.conversation.messages.push(
      createMessage(MessageRole.User, 'hi')
    );
    const service = new ChatSessionService(repository, createProviderStub());

    const updated = await service.renameSession('session-1', '  My chat  ');

    expect(updated.title).toBe('My chat');
    expect(repository.conversation.title).toBe('My chat');
    // Messages are preserved — only the title changed.
    expect(repository.conversation.messages).toHaveLength(1);
  });

  it('clears the title when renamed to a blank string', async () => {
    const repository = new InMemoryConversationRepository();
    repository.conversation.title = 'Old title';
    const service = new ChatSessionService(repository, createProviderStub());

    const updated = await service.renameSession('session-1', '   ');

    expect(updated.title).toBeUndefined();
    expect(repository.conversation.title).toBeUndefined();
  });

  it('pins a session without touching its messages', async () => {
    const repository = new InMemoryConversationRepository();
    repository.conversation.messages.push(
      createMessage(MessageRole.User, 'hi')
    );
    const service = new ChatSessionService(repository, createProviderStub());

    const updated = await service.setSessionPinned('session-1', true);

    expect(updated.pinned).toBe(true);
    expect(repository.conversation.pinned).toBe(true);
    expect(repository.conversation.messages).toHaveLength(1);
  });

  it('drops the pinned flag when unpinned', async () => {
    const repository = new InMemoryConversationRepository();
    repository.conversation.pinned = true;
    const service = new ChatSessionService(repository, createProviderStub());

    const updated = await service.setSessionPinned('session-1', false);

    expect(updated.pinned).toBeUndefined();
    expect(repository.conversation.pinned).toBeUndefined();
  });

  it('injects root AGENTS.md into the system prompt when available', async () => {
    const repository = new InMemoryConversationRepository();
    const seenMessages: Array<{ role: string; content: string }> = [];
    const provider: ProviderClient = {
      providerId: ProviderId.Ollama,
      async sendChat({ messages }): Promise<ChatResult> {
        seenMessages.push(
          ...messages.map((message) => ({
            role: message.role,
            content: message.content,
          }))
        );
        return { content: 'ok' };
      },
      async listModels() {
        return [
          {
            id: 'llama3.1',
            displayName: 'llama3.1',
            providerId: ProviderId.Ollama,
          },
        ];
      },
      getDefaultModel() {
        return undefined;
      },
    };

    const service = new ChatSessionService(repository, provider, {
      workspaceFiles: new InMemoryWorkspaceFiles({
        'AGENTS.md': '1. Search first.\n2. Read only required files.',
      }),
    });

    await service.submitMessage({
      conversation: titledConversation('session-1'),
      model: 'llama3.1',
      content: 'Hello',
    });

    expect(seenMessages[0]).toEqual({
      role: 'system',
      content: expect.stringContaining('Project instructions from AGENTS.md:'),
    });
    expect(seenMessages[0]?.content).toContain('1. Search first.');
    expect(seenMessages[0]?.content).toContain('2. Read only required files.');
  });

  it('uses the configured system prompt when sending chat messages', async () => {
    const repository = new InMemoryConversationRepository();
    const seenMessages: Array<{ role: string; content: string }> = [];
    const provider: ProviderClient = {
      providerId: ProviderId.Ollama,
      async sendChat({ messages }): Promise<ChatResult> {
        seenMessages.push(
          ...messages.map((message) => ({
            role: message.role,
            content: message.content,
          }))
        );
        return { content: 'ok' };
      },
      async listModels() {
        return [
          {
            id: 'llama3.1',
            displayName: 'llama3.1',
            providerId: ProviderId.Ollama,
          },
        ];
      },
      getDefaultModel() {
        return undefined;
      },
    };

    const service = new ChatSessionService(repository, provider, {
      systemPrompt: 'Custom prompt line 1\nCustom prompt line 2',
    });

    await service.submitMessage({
      conversation: titledConversation('session-1'),
      model: 'llama3.1',
      content: 'Hello',
    });

    expect(seenMessages[0]).toEqual({
      role: 'system',
      content: expect.stringContaining('Custom prompt line 1'),
    });
    expect(seenMessages[0]?.content).toContain('Custom prompt line 2');
  });

  it('stores message attachments when files are included in a prompt', async () => {
    const repository = new InMemoryConversationRepository();
    const service = new ChatSessionService(repository, createProviderStub());

    const startedSession = await service.startSession({
      sessionId: 'session-1',
    });
    const result = await service.submitMessage({
      conversation: startedSession.conversation,
      model: startedSession.activeModel,
      content: 'Review @src/app.ts',
      attachments: [{ path: 'src/app.ts', content: 'console.log("hello")' }],
    });

    expect(result.conversation.messages[0]?.attachments).toEqual([
      { path: 'src/app.ts', content: 'console.log("hello")' },
    ]);
  });

  it('aborts an in-flight request when the signal is cancelled', async () => {
    const repository = new InMemoryConversationRepository();
    const service = new ChatSessionService(
      repository,
      createAbortableProvider()
    );
    const controller = new AbortController();

    const startedSession = await service.startSession({
      sessionId: 'session-1',
    });

    const submitPromise = service.submitMessage({
      conversation: startedSession.conversation,
      model: startedSession.activeModel,
      content: 'Hello',
      signal: controller.signal,
    });

    controller.abort();

    let caught: unknown;
    await submitPromise.catch((error: unknown) => {
      caught = error;
    });
    expect(caught).toMatchObject({ name: 'AbortError' });
    // An interrupted turn is persisted (here: just the user message — nothing
    // had streamed yet), and the saved conversation rides on the abort error
    // so hosts can adopt it.
    expect(repository.conversation.messages.map((m) => m.role)).toEqual([
      'user',
    ]);
    expect(getInterruptedConversation(caught)).toEqual(repository.conversation);
  });

  it('persists partially streamed answer and thinking when a turn is interrupted', async () => {
    const repository = new InMemoryConversationRepository();
    const controller = new AbortController();
    const provider: ProviderClient = {
      providerId: ProviderId.Ollama,
      async sendChat({
        signal,
        onToken,
        onThinkingToken,
      }): Promise<ChatResult> {
        onThinkingToken?.('pondering deeply');
        onToken?.('partial answer');
        return await new Promise<ChatResult>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () =>
              reject(
                new DOMException('The operation was aborted.', 'AbortError')
              ),
            { once: true }
          );
        });
      },
      async listModels() {
        return [
          {
            id: 'llama3.1',
            displayName: 'llama3.1',
            providerId: ProviderId.Ollama,
          },
        ];
      },
      getDefaultModel() {
        return undefined;
      },
    };
    const service = new ChatSessionService(repository, provider);

    const submitPromise = service.submitMessage({
      conversation: titledConversation('session-1'),
      model: 'llama3.1',
      content: 'Hello',
      signal: controller.signal,
    });
    // Let sendChat emit its tokens before cancelling.
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expect(submitPromise).rejects.toMatchObject({ name: 'AbortError' });

    const messages = repository.conversation.messages;
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[1]?.content).toBe('partial answer');
    expect(messages[1]?.thinking?.content).toBe('pondering deeply');
  });

  it('closes dangling tool calls with a synthetic result when interrupted mid-tool', async () => {
    const repository = new InMemoryConversationRepository();
    const controller = new AbortController();
    const hangingTool: Tool = {
      requiresApproval: false,
      definition: {
        name: 'write_file',
        description: 'writes a file',
        parameters: { type: 'object' },
      },
      describe: () => ({ title: 'write' }),
      execute: (_rawArguments, context) =>
        new Promise((_resolve, reject) => {
          // The tool only ends when the turn is cancelled.
          controller.abort();
          context.signal?.addEventListener(
            'abort',
            () =>
              reject(
                new DOMException('The operation was aborted.', 'AbortError')
              ),
            { once: true }
          );
          if (context.signal?.aborted) {
            reject(
              new DOMException('The operation was aborted.', 'AbortError')
            );
          }
        }),
    };
    const service = new ChatSessionService(
      repository,
      createToolCallingProvider(),
      { toolRegistry: new ToolRegistry([hangingTool]) }
    );

    await expect(
      service.submitMessage({
        conversation: titledConversation('session-1'),
        model: 'gpt',
        content: 'create a.txt',
        signal: controller.signal,
        allowUnattended: true,
      })
    ).rejects.toMatchObject({ name: 'AbortError' });

    const messages = repository.conversation.messages;
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    const toolMessage = messages[2];
    expect(toolMessage?.toolCallId).toBe('call-1');
    expect(toolMessage?.content).toContain('Interrupted by user');
  });

  it('executes a requested tool and feeds the result back to the model', async () => {
    const repository = new InMemoryConversationRepository();
    const tool = new RecordingWriteTool();
    const service = new ChatSessionService(
      repository,
      createToolCallingProvider(),
      {
        toolRegistry: new ToolRegistry([tool]),
      }
    );

    const result = await service.submitMessage({
      conversation: titledConversation('session-1'),
      model: 'gpt',
      content: 'create a.txt',
      // No interactive approver here; opt into unattended execution so the
      // approval-gated write tool runs (see the fail-closed test below).
      allowUnattended: true,
    });

    expect(tool.executed).toEqual(['{"path":"a.txt","content":"hi"}']);
    expect(result.reply).toBe('All done.');
    expect(result.conversation.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    const toolMessage = result.conversation.messages[2];
    expect(toolMessage?.toolCallId).toBe('call-1');
    expect(toolMessage?.content).toBe('wrote the file');
  });

  it('folds queued steering messages into the in-flight turn before the next model call', async () => {
    const repository = new InMemoryConversationRepository();
    const tool = new RecordingWriteTool();
    const seenMessageRoles: string[][] = [];
    let turn = 0;
    const provider: ProviderClient = {
      providerId: ProviderId.Openai,
      async sendChat({ messages }): Promise<ChatResult> {
        seenMessageRoles.push(messages.map((m) => m.role));
        turn += 1;
        if (turn === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'call-1',
                name: 'write_file',
                arguments: '{"path":"a.txt","content":"hi"}',
              },
            ],
          };
        }
        return { content: 'All done.' };
      },
      async listModels() {
        return [
          { id: 'gpt', displayName: 'gpt', providerId: ProviderId.Openai },
        ];
      },
      getDefaultModel() {
        return 'gpt';
      },
    };
    const service = new ChatSessionService(repository, provider, {
      toolRegistry: new ToolRegistry([tool]),
    });

    // Nothing is queued at the first step (the user has only just submitted);
    // the steering message arrives by the second step, mirroring a user typing
    // while the turn runs.
    let drainCalls = 0;
    const result = await service.submitMessage({
      conversation: titledConversation('session-1'),
      model: 'gpt',
      content: 'create a.txt',
      drainSteering: () => {
        drainCalls += 1;
        return drainCalls === 2 ? 'actually make it b.txt' : null;
      },
    });

    // The first model call sees no steering; the second sees the queued message
    // appended as a user turn after the tool result.
    expect(seenMessageRoles[0]).toEqual(['system', 'user']);
    expect(seenMessageRoles[1]).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'user',
    ]);
    const steered = result.conversation.messages.find(
      (m) => m.role === 'user' && m.content === 'actually make it b.txt'
    );
    expect(steered).toBeDefined();
  });

  it('retries chat-only and omits tools when the model rejects tools', async () => {
    const repository = new InMemoryConversationRepository();
    const tool = new RecordingWriteTool();
    const requests: Array<ChatRequest['tools']> = [];
    let firstCall = true;
    const provider: ProviderClient = {
      providerId: ProviderId.Ollama,
      async sendChat(request: ChatRequest): Promise<ChatResult> {
        requests.push(request.tools);
        if (firstCall) {
          firstCall = false;
          throw new ToolsUnsupportedError('model does not support tools');
        }
        return { content: 'hi from a chat-only model' };
      },
      async listModels() {
        return [
          { id: 'gemma', displayName: 'gemma', providerId: ProviderId.Ollama },
        ];
      },
      getDefaultModel() {
        return 'gemma';
      },
    };
    const service = new ChatSessionService(repository, provider, {
      toolRegistry: new ToolRegistry([tool]),
    });

    const result = await service.submitMessage({
      conversation: titledConversation('session-1'),
      model: 'gemma',
      content: 'hello',
    });

    expect(result.reply).toBe('hi from a chat-only model');
    // First attempt sent tools; the retry omitted them.
    expect(requests[0]?.length).toBeGreaterThan(0);
    expect(requests[1]).toBeUndefined();

    // A second message skips tools immediately (no failed attempt).
    requests.length = 0;
    await service.submitMessage({
      conversation: result.conversation,
      model: 'gemma',
      content: 'again',
    });
    expect(requests).toEqual([undefined]);
  });

  it('describeTool includes previewDiff output when available', async () => {
    const view = await describeTool(
      new PreviewingWriteTool(),
      '{"path":"a.txt","content":"after"}',
      { workspaceRoot: '/workspace' }
    );

    expect(view.title).toBe('write');
    expect(view.diff).toEqual({
      path: 'a.txt',
      oldText: 'before',
      newText: 'after',
    });
  });

  it('skips execution and reports rejection when approval is denied', async () => {
    const repository = new InMemoryConversationRepository();
    const tool = new RecordingWriteTool();
    const service = new ChatSessionService(
      repository,
      createToolCallingProvider(),
      {
        toolRegistry: new ToolRegistry([tool]),
      }
    );

    const result = await service.submitMessage({
      conversation: titledConversation('session-1'),
      model: 'gpt',
      content: 'create a.txt',
      requestApproval: async () => false,
    });

    expect(tool.executed).toEqual([]);
    expect(result.reply).toBe('All done.');
    expect(result.conversation.messages[2]?.content).toContain('rejected');
  });

  it('fails closed: refuses an approval-gated tool when no approver is wired', async () => {
    const repository = new InMemoryConversationRepository();
    const tool = new RecordingWriteTool();
    const service = new ChatSessionService(
      repository,
      createToolCallingProvider(),
      {
        toolRegistry: new ToolRegistry([tool]),
      }
    );

    // Neither requestApproval nor allowUnattended: the write tool
    // (requiresApproval = true) must NOT run.
    const result = await service.submitMessage({
      conversation: titledConversation('session-1'),
      model: 'gpt',
      content: 'create a.txt',
    });

    expect(tool.executed).toEqual([]);
    expect(result.conversation.messages[2]?.content).toContain('rejected');
  });

  it('starts with lazy_load_tools only, then exposes the tools the model enables', async () => {
    const repository = new InMemoryConversationRepository();
    const delegatedTool = new RecordingWriteTool();
    const lazyLoadTool = new LazyLoadToolsTool([
      {
        ...delegatedTool.definition,
        requiresApproval: delegatedTool.requiresApproval,
      },
    ]);
    const seenRequests: Array<ChatRequest['tools']> = [];
    let turn = 0;
    const provider: ProviderClient = {
      providerId: ProviderId.Openai,
      async sendChat(request: ChatRequest): Promise<ChatResult> {
        seenRequests.push(request.tools);
        turn += 1;
        // First the model lists the catalog, then enables what it needs, then
        // calls the enabled tool.
        if (turn === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'call-discover',
                name: 'lazy_load_tools',
                arguments: '{}',
              },
            ],
          };
        }
        if (turn === 2) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'call-enable',
                name: 'lazy_load_tools',
                arguments: '{"enable":["write_file"]}',
              },
            ],
          };
        }
        if (turn === 3) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'call-write',
                name: 'write_file',
                arguments: '{"path":"a.txt","content":"hi"}',
              },
            ],
          };
        }
        return { content: 'All done.' };
      },
      async listModels() {
        return [
          { id: 'gpt', displayName: 'gpt', providerId: ProviderId.Openai },
        ];
      },
      getDefaultModel() {
        return 'gpt';
      },
    };
    const service = new ChatSessionService(repository, provider, {
      toolRegistry: new ToolRegistry(
        [lazyLoadTool, delegatedTool],
        [
          {
            ...lazyLoadTool.definition,
            requiresApproval: lazyLoadTool.requiresApproval,
          },
        ]
      ),
    });

    const approvals: string[] = [];
    const result = await service.submitMessage({
      conversation: titledConversation('session-1'),
      model: 'gpt',
      content: 'create a.txt',
      requestApproval: async ({ toolName }) => {
        approvals.push(toolName);
        return true;
      },
    });

    expect(seenRequests[0]).toEqual([
      expect.objectContaining({ name: 'lazy_load_tools' }),
    ]);
    // The catalog call lists tool names only (no descriptions — they'd ride
    // along in history for the rest of the session) and activates nothing —
    // the next request still advertises only the gateway.
    const catalogResult = result.conversation.messages.find(
      (message) =>
        message.role === 'tool' && message.toolCallId === 'call-discover'
    );
    expect(catalogResult?.content).toContain('"write_file"');
    expect(catalogResult?.content).not.toContain('writes a file');
    expect(seenRequests[1]?.map((tool) => tool.name)).toEqual([
      'lazy_load_tools',
    ]);
    // After enabling, the tool's full schema is advertised — and the gateway
    // stays in the set so the model can keep toggling.
    expect(seenRequests[2]?.map((tool) => tool.name)).toEqual([
      'lazy_load_tools',
      'write_file',
    ]);
    expect(approvals).toEqual(['write_file']);
    expect(delegatedTool.executed).toEqual(['{"path":"a.txt","content":"hi"}']);
    expect(result.reply).toBe('All done.');
    // The enabled set is persisted on the conversation so a resume restores it.
    expect(result.conversation.activeTools).toEqual(['write_file']);
  });

  it('excludes a disabled tool when lazy loading swaps in the real toolset', async () => {
    const repository = new InMemoryConversationRepository();
    const writeTool = new RecordingWriteTool();
    // A second, enabled tool so the post-load request isn't empty — the disabled
    // one must drop out while this one survives.
    const readTool: Tool = {
      definition: {
        name: 'read_file',
        description: 'reads a file',
        parameters: { type: 'object' },
      },
      requiresApproval: false,
      describe: () => ({ title: 'read' }),
      execute: async () => ({ content: 'read the file' }),
    };
    const lazyLoadTool = new LazyLoadToolsTool([
      {
        ...writeTool.definition,
        requiresApproval: writeTool.requiresApproval,
      },
      { ...readTool.definition, requiresApproval: readTool.requiresApproval },
    ]);
    const seenRequests: Array<ChatRequest['tools']> = [];
    let turn = 0;
    const provider: ProviderClient = {
      providerId: ProviderId.Openai,
      async sendChat(request: ChatRequest): Promise<ChatResult> {
        seenRequests.push(request.tools);
        turn += 1;
        // The model tries to enable both tools via the gateway, then stops.
        if (turn === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'call-enable',
                name: 'lazy_load_tools',
                arguments: '{"enable":["write_file","read_file"]}',
              },
            ],
          };
        }
        return { content: 'Done.' };
      },
      async listModels() {
        return [
          { id: 'gpt', displayName: 'gpt', providerId: ProviderId.Openai },
        ];
      },
      getDefaultModel() {
        return 'gpt';
      },
    };
    const service = new ChatSessionService(repository, provider, {
      toolRegistry: new ToolRegistry(
        [lazyLoadTool, writeTool, readTool],
        [
          {
            ...lazyLoadTool.definition,
            requiresApproval: lazyLoadTool.requiresApproval,
          },
        ]
      ),
      getDisabledToolNames: () => ['write_file'],
    });

    const result = await service.submitMessage({
      conversation: titledConversation('session-1'),
      model: 'gpt',
      content: 'do something',
      requestApproval: async () => true,
    });

    // The request right after the toggle carries the enabled tool minus the
    // user-disabled write_file — the model can't enable a tool the user turned
    // off. The gateway stays in so the model can keep toggling.
    const postLoad = seenRequests[1]?.map((tool) => tool.name);
    expect(postLoad).toContain('read_file');
    expect(postLoad).not.toContain('write_file');
    expect(postLoad).toContain('lazy_load_tools');
    // The refused name is reported back to the model and never persisted.
    const toggleResult = result.conversation.messages.find(
      (message) =>
        message.role === 'tool' && message.toolCallId === 'call-enable'
    );
    expect(toggleResult?.content).toContain('write_file');
    expect(toggleResult?.content).toContain('Unknown or unavailable');
    expect(result.conversation.activeTools).toEqual(['read_file']);
  });

  it('advertises the full tool set from the first turn when lazy loading is off', async () => {
    const repository = new InMemoryConversationRepository();
    const delegatedTool = new RecordingWriteTool();
    const lazyLoadTool = new LazyLoadToolsTool([
      {
        ...delegatedTool.definition,
        requiresApproval: delegatedTool.requiresApproval,
      },
    ]);
    const seenRequests: Array<ChatRequest['tools']> = [];
    let turn = 0;
    const provider: ProviderClient = {
      providerId: ProviderId.Openai,
      async sendChat(request: ChatRequest): Promise<ChatResult> {
        seenRequests.push(request.tools);
        turn += 1;
        // No loading step needed: the model can call write_file immediately
        // because every tool was advertised up front.
        if (turn === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'call-write',
                name: 'write_file',
                arguments: '{"path":"a.txt","content":"hi"}',
              },
            ],
          };
        }
        return { content: 'All done.' };
      },
      async listModels() {
        return [
          { id: 'gpt', displayName: 'gpt', providerId: ProviderId.Openai },
        ];
      },
      getDefaultModel() {
        return 'gpt';
      },
    };
    const service = new ChatSessionService(repository, provider, {
      toolRegistry: new ToolRegistry(
        [lazyLoadTool, delegatedTool],
        [
          {
            ...lazyLoadTool.definition,
            requiresApproval: lazyLoadTool.requiresApproval,
          },
        ]
      ),
      getLazyToolLoadingEnabled: () => false,
    });

    const result = await service.submitMessage({
      conversation: titledConversation('session-1'),
      model: 'gpt',
      content: 'create a.txt',
      requestApproval: async () => true,
    });

    // The very first request carries the real tools — and not the now-pointless
    // lazy_load_tools gateway, since everything is already advertised.
    expect(seenRequests[0]?.map((tool) => tool.name)).toEqual(['write_file']);
    expect(seenRequests[0]?.map((tool) => tool.name)).not.toContain(
      'lazy_load_tools'
    );
    expect(delegatedTool.executed).toEqual(['{"path":"a.txt","content":"hi"}']);
    expect(result.reply).toBe('All done.');
  });

  it('does not advertise a disabled tool, and refuses it if the model calls it anyway', async () => {
    const repository = new InMemoryConversationRepository();
    const delegatedTool = new RecordingWriteTool();
    const lazyLoadTool = new LazyLoadToolsTool([
      {
        ...delegatedTool.definition,
        requiresApproval: delegatedTool.requiresApproval,
      },
    ]);
    const seenRequests: Array<ChatRequest['tools']> = [];
    let turn = 0;
    const provider: ProviderClient = {
      providerId: ProviderId.Openai,
      async sendChat(request: ChatRequest): Promise<ChatResult> {
        seenRequests.push(request.tools);
        turn += 1;
        // The model calls the disabled tool anyway (e.g. it saw it on an earlier
        // turn); the service should refuse rather than run it.
        if (turn === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'call-write',
                name: 'write_file',
                arguments: '{"path":"a.txt","content":"hi"}',
              },
            ],
          };
        }
        return { content: 'Understood.' };
      },
      async listModels() {
        return [
          { id: 'gpt', displayName: 'gpt', providerId: ProviderId.Openai },
        ];
      },
      getDefaultModel() {
        return 'gpt';
      },
    };
    const service = new ChatSessionService(repository, provider, {
      toolRegistry: new ToolRegistry(
        [lazyLoadTool, delegatedTool],
        [
          {
            ...lazyLoadTool.definition,
            requiresApproval: lazyLoadTool.requiresApproval,
          },
        ]
      ),
      getLazyToolLoadingEnabled: () => false,
      getDisabledToolNames: () => ['write_file'],
    });

    const result = await service.submitMessage({
      conversation: titledConversation('session-1'),
      model: 'gpt',
      content: 'create a.txt',
      requestApproval: async () => true,
    });

    // The disabled tool is never advertised (here it was the only one, so the
    // request carries no tools at all)...
    expect((seenRequests[0] ?? []).map((tool) => tool.name)).not.toContain(
      'write_file'
    );
    // ...and a stray call to it is refused without executing the tool.
    expect(delegatedTool.executed).toEqual([]);
    expect(result.reply).toBe('Understood.');
  });

  it('keeps enabled tools advertised on later turns via the persisted active set', async () => {
    const repository = new InMemoryConversationRepository();
    const delegatedTool = new RecordingWriteTool();
    const lazyLoadTool = new LazyLoadToolsTool([
      {
        ...delegatedTool.definition,
        requiresApproval: delegatedTool.requiresApproval,
      },
    ]);
    const seenRequests: Array<ChatRequest['tools']> = [];
    let turn = 0;
    const provider: ProviderClient = {
      providerId: ProviderId.Openai,
      async sendChat(request: ChatRequest): Promise<ChatResult> {
        seenRequests.push(request.tools);
        turn += 1;
        // First turn enables write_file, every later turn just replies.
        if (turn === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'call-enable',
                name: 'lazy_load_tools',
                arguments: '{"enable":["write_file"]}',
              },
            ],
          };
        }
        return { content: 'Done.' };
      },
      async listModels() {
        return [
          { id: 'gpt', displayName: 'gpt', providerId: ProviderId.Openai },
        ];
      },
      getDefaultModel() {
        return 'gpt';
      },
    };
    const service = new ChatSessionService(repository, provider, {
      toolRegistry: new ToolRegistry(
        [lazyLoadTool, delegatedTool],
        [
          {
            ...lazyLoadTool.definition,
            requiresApproval: lazyLoadTool.requiresApproval,
          },
        ]
      ),
    });

    const first = await service.submitMessage({
      conversation: titledConversation('session-1'),
      model: 'gpt',
      content: 'discover',
    });

    // Reusing the same conversation, the next turn must advertise the enabled
    // tool up front — restored from the persisted active set, not re-derived
    // from history — and the gateway stays in so the model can keep toggling.
    expect(first.conversation.activeTools).toEqual(['write_file']);
    await service.submitMessage({
      conversation: first.conversation,
      model: 'gpt',
      content: 'now write',
    });

    const followUpRequest = seenRequests[seenRequests.length - 1];
    expect(followUpRequest?.map((tool) => tool.name)).toEqual([
      'lazy_load_tools',
      'write_file',
    ]);
  });

  it('treats a direct call of a catalog tool as an implicit enable', async () => {
    const repository = new InMemoryConversationRepository();
    const delegatedTool = new RecordingWriteTool();
    const lazyLoadTool = new LazyLoadToolsTool([
      {
        ...delegatedTool.definition,
        requiresApproval: delegatedTool.requiresApproval,
      },
    ]);
    const seenRequests: Array<ChatRequest['tools']> = [];
    let turn = 0;
    const provider: ProviderClient = {
      providerId: ProviderId.Openai,
      async sendChat(request: ChatRequest): Promise<ChatResult> {
        seenRequests.push(request.tools);
        turn += 1;
        // The model skips the {"enable": [...]} round trip and calls the tool
        // straight off the catalog (small models do this constantly).
        if (turn === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'call-write',
                name: 'write_file',
                arguments: '{"path":"a.txt","content":"hi"}',
              },
            ],
          };
        }
        return { content: 'Done.' };
      },
      async listModels() {
        return [
          { id: 'gpt', displayName: 'gpt', providerId: ProviderId.Openai },
        ];
      },
      getDefaultModel() {
        return 'gpt';
      },
    };
    const service = new ChatSessionService(repository, provider, {
      toolRegistry: new ToolRegistry(
        [lazyLoadTool, delegatedTool],
        [
          {
            ...lazyLoadTool.definition,
            requiresApproval: lazyLoadTool.requiresApproval,
          },
        ]
      ),
    });

    const result = await service.submitMessage({
      conversation: titledConversation('session-1'),
      model: 'gpt',
      content: 'create a.txt',
      requestApproval: async () => true,
    });

    // The call ran, the tool became active (schema advertised on the very next
    // request of the same turn), and the implicit enable is persisted.
    expect(delegatedTool.executed).toEqual(['{"path":"a.txt","content":"hi"}']);
    expect(seenRequests[1]?.map((tool) => tool.name)).toEqual([
      'lazy_load_tools',
      'write_file',
    ]);
    expect(result.conversation.activeTools).toEqual(['write_file']);
  });

  it('lists the callable tools when the model calls an unknown tool name', async () => {
    const repository = new InMemoryConversationRepository();
    const delegatedTool = new RecordingWriteTool();
    const lazyLoadTool = new LazyLoadToolsTool([
      {
        ...delegatedTool.definition,
        requiresApproval: delegatedTool.requiresApproval,
      },
    ]);
    let turn = 0;
    const provider: ProviderClient = {
      providerId: ProviderId.Openai,
      async sendChat(): Promise<ChatResult> {
        turn += 1;
        // A harmony-style mangled name that never reaches the registry.
        if (turn === 1) {
          return {
            content: '',
            toolCalls: [
              { id: 'call-bad', name: 'not_a_tool', arguments: '{}' },
            ],
          };
        }
        return { content: 'Done.' };
      },
      async listModels() {
        return [
          { id: 'gpt', displayName: 'gpt', providerId: ProviderId.Openai },
        ];
      },
      getDefaultModel() {
        return 'gpt';
      },
    };
    const service = new ChatSessionService(repository, provider, {
      toolRegistry: new ToolRegistry(
        [lazyLoadTool, delegatedTool],
        [
          {
            ...lazyLoadTool.definition,
            requiresApproval: lazyLoadTool.requiresApproval,
          },
        ]
      ),
    });

    const result = await service.submitMessage({
      conversation: titledConversation('session-1'),
      model: 'gpt',
      content: 'do something',
    });

    // The error names the real tools so the model can self-correct instead of
    // retrying the bad name — and the failed call activates nothing.
    const errorResult = result.conversation.messages.find(
      (message) => message.role === 'tool' && message.toolCallId === 'call-bad'
    );
    expect(errorResult?.content).toContain('Unknown tool: not_a_tool');
    expect(errorResult?.content).toContain('Available tools: write_file');
    expect(result.conversation.activeTools ?? []).toEqual([]);
  });

  it('falls back to every tool for a legacy session that called the old load-everything gateway', async () => {
    const repository = new InMemoryConversationRepository();
    const delegatedTool = new RecordingWriteTool();
    const lazyLoadTool = new LazyLoadToolsTool([
      {
        ...delegatedTool.definition,
        requiresApproval: delegatedTool.requiresApproval,
      },
    ]);
    const seenRequests: Array<ChatRequest['tools']> = [];
    const provider: ProviderClient = {
      providerId: ProviderId.Openai,
      async sendChat(request: ChatRequest): Promise<ChatResult> {
        seenRequests.push(request.tools);
        return { content: 'Done.' };
      },
      async listModels() {
        return [
          { id: 'gpt', displayName: 'gpt', providerId: ProviderId.Openai },
        ];
      },
      getDefaultModel() {
        return 'gpt';
      },
    };
    const service = new ChatSessionService(repository, provider, {
      toolRegistry: new ToolRegistry(
        [lazyLoadTool, delegatedTool],
        [
          {
            ...lazyLoadTool.definition,
            requiresApproval: lazyLoadTool.requiresApproval,
          },
        ]
      ),
    });

    // A session saved by the old code: the gateway call is in history, but no
    // `activeTools` was ever persisted.
    const legacy = titledConversation('session-legacy');
    legacy.messages.push(
      createMessage(MessageRole.User, 'do something', new Date()),
      createMessage(MessageRole.Assistant, '', new Date(), undefined, {
        toolCalls: [
          { id: 'call-old', name: 'lazy_load_tools', arguments: '{}' },
        ],
      }),
      createMessage(
        MessageRole.Tool,
        'Tool loading acknowledged.',
        new Date(),
        undefined,
        {
          toolCallId: 'call-old',
          name: 'lazy_load_tools',
        }
      )
    );

    const result = await service.submitMessage({
      conversation: legacy,
      model: 'gpt',
      content: 'continue',
    });

    // The legacy session resumes with everything advertised (its old behavior),
    // and the fallback is made explicit by persisting the full set.
    expect(seenRequests[0]?.map((tool) => tool.name)).toEqual([
      'lazy_load_tools',
      'write_file',
    ]);
    expect(result.conversation.activeTools).toEqual(['write_file']);
  });

  it('re-advertises the gateway on every turn until the model calls it', async () => {
    const repository = new InMemoryConversationRepository();
    const delegatedTool = new RecordingWriteTool();
    const lazyLoadTool = new LazyLoadToolsTool([
      {
        ...delegatedTool.definition,
        requiresApproval: delegatedTool.requiresApproval,
      },
    ]);
    const seenRequests: Array<ChatRequest['tools']> = [];
    const provider: ProviderClient = {
      providerId: ProviderId.Openai,
      async sendChat(request: ChatRequest): Promise<ChatResult> {
        // The model never calls lazy_load_tools — it just answers each turn.
        seenRequests.push(request.tools);
        return { content: 'Sure.' };
      },
      async listModels() {
        return [
          { id: 'gpt', displayName: 'gpt', providerId: ProviderId.Openai },
        ];
      },
      getDefaultModel() {
        return 'gpt';
      },
    };
    const service = new ChatSessionService(repository, provider, {
      toolRegistry: new ToolRegistry(
        [lazyLoadTool, delegatedTool],
        [
          {
            ...lazyLoadTool.definition,
            requiresApproval: lazyLoadTool.requiresApproval,
          },
        ]
      ),
    });

    const first = await service.submitMessage({
      conversation: titledConversation('session-1'),
      model: 'gpt',
      content: 'hello',
    });
    // Second turn on the same conversation: the model still hasn't loaded tools,
    // so the gateway must be offered again so it can still opt in later.
    await service.submitMessage({
      conversation: first.conversation,
      model: 'gpt',
      content: 'still hello',
    });

    // Both requests advertised the gateway, since it was never called.
    expect(seenRequests[0]?.map((tool) => tool.name)).toEqual([
      'lazy_load_tools',
    ]);
    expect(
      seenRequests[seenRequests.length - 1]?.map((tool) => tool.name)
    ).toEqual(['lazy_load_tools']);
  });
});

describe('compactSession', () => {
  function conversationWithHistory(): ReturnType<typeof createConversation> {
    const conversation = titledConversation('session-1');
    conversation.messages = [
      createMessage(MessageRole.User, 'first question'),
      createMessage(MessageRole.Assistant, 'first answer'),
      createMessage(MessageRole.User, 'second question'),
      createMessage(MessageRole.Assistant, 'second answer'),
    ];
    return conversation;
  }

  it('sends the system prompt, history, and compact prompt with no tools', async () => {
    const repository = new InMemoryConversationRepository();
    const requests: ChatRequest[] = [];
    const provider: ProviderClient = {
      ...createProviderStub(),
      async sendChat(request: ChatRequest): Promise<ChatResult> {
        requests.push(request);
        return { content: 'the summary' };
      },
    };
    const service = new ChatSessionService(repository, provider, {
      toolRegistry: new ToolRegistry([new RecordingWriteTool()], []),
    });

    await service.compactSession({
      conversation: conversationWithHistory(),
      model: 'llama3.1',
    });

    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.tools).toBeUndefined();
    expect(request.messages[0]?.role).toBe('system');
    // The full history rides between the system prompt and the compact prompt.
    expect(request.messages.slice(1, -1).map((m) => m.content)).toEqual([
      'first question',
      'first answer',
      'second question',
      'second answer',
    ]);
    const last = request.messages[request.messages.length - 1]!;
    expect(last.role).toBe('user');
    expect(last.content).toBe(DEFAULT_COMPACT_PROMPT);
  });

  it('replaces messages with a flagged summary and accumulates previousMessages', async () => {
    const repository = new InMemoryConversationRepository();
    const provider: ProviderClient = {
      ...createProviderStub(),
      async sendChat(): Promise<ChatResult> {
        return {
          content: 'summary text',
          usage: { inputTokens: 100, outputTokens: 20, cachedTokens: 0 },
        };
      },
    };
    const service = new ChatSessionService(repository, provider);
    const conversation = conversationWithHistory();
    conversation.stats = {
      inputTokens: 1000,
      outputTokens: 200,
      cachedTokens: 0,
      cost: 0.5,
      lastInputTokens: 900,
    };

    const first = await service.compactSession({
      conversation,
      model: 'llama3.1',
    });

    expect(first.summary).toBe('summary text');
    expect(first.usage?.inputTokens).toBe(100);
    expect(first.conversation.messages).toHaveLength(1);
    const summaryMessage = first.conversation.messages[0]!;
    expect(summaryMessage.role).toBe('user');
    expect(summaryMessage.isCompactSummary).toBe(true);
    expect(summaryMessage.content).toContain(COMPACT_CONTINUATION_HEADER);
    expect(summaryMessage.content).toContain('summary text');
    expect(first.conversation.previousMessages).toHaveLength(4);
    // The ctx readout resets so auto-compact doesn't immediately refire.
    expect(first.conversation.stats?.lastInputTokens).toBe(0);
    expect(first.conversation.stats?.inputTokens).toBe(1000);
    // Persisted once, as returned.
    expect(repository.conversation).toEqual(first.conversation);

    // A second compaction (after more turns) accumulates the prior epoch.
    first.conversation.messages.push(
      createMessage(MessageRole.User, 'third question'),
      createMessage(MessageRole.Assistant, 'third answer')
    );
    const second = await service.compactSession({
      conversation: first.conversation,
      model: 'llama3.1',
    });
    expect(second.conversation.previousMessages).toHaveLength(4 + 3);
    expect(second.conversation.messages).toHaveLength(1);
  });

  it('throws when there is nothing to compact and never saves', async () => {
    const repository = new InMemoryConversationRepository();
    const original = repository.conversation;
    const service = new ChatSessionService(repository, createProviderStub());

    await expect(
      service.compactSession({
        conversation: titledConversation('session-1'),
        model: 'llama3.1',
      })
    ).rejects.toThrow(/nothing new to compact/i);

    const summaryOnly = titledConversation('session-1');
    summaryOnly.messages = [
      createMessage(MessageRole.User, 'summary', new Date(), undefined, {
        isCompactSummary: true,
      }),
    ];
    await expect(
      service.compactSession({ conversation: summaryOnly, model: 'llama3.1' })
    ).rejects.toThrow(/nothing new to compact/i);
    expect(repository.conversation).toBe(original);
  });

  it('does not save when the provider fails or returns an empty summary', async () => {
    const repository = new InMemoryConversationRepository();
    const original = repository.conversation;
    const failingProvider: ProviderClient = {
      ...createProviderStub(),
      async sendChat(): Promise<ChatResult> {
        throw new Error('provider exploded');
      },
    };
    const failing = new ChatSessionService(repository, failingProvider);
    await expect(
      failing.compactSession({
        conversation: conversationWithHistory(),
        model: 'llama3.1',
      })
    ).rejects.toThrow('provider exploded');
    expect(repository.conversation).toBe(original);

    const emptyProvider: ProviderClient = {
      ...createProviderStub(),
      async sendChat(): Promise<ChatResult> {
        return { content: '   ' };
      },
    };
    const empty = new ChatSessionService(repository, emptyProvider);
    await expect(
      empty.compactSession({
        conversation: conversationWithHistory(),
        model: 'llama3.1',
      })
    ).rejects.toThrow(/empty summary/i);
    expect(repository.conversation).toBe(original);
  });

  it('strips tag-style scratch work from the summary before persisting', async () => {
    const repository = new InMemoryConversationRepository();
    const provider: ProviderClient = {
      ...createProviderStub(),
      async sendChat(): Promise<ChatResult> {
        return {
          content:
            '<analysis>long scratch review</analysis>\n<summary>## Current Work\nthe real summary</summary>',
        };
      },
    };
    const service = new ChatSessionService(repository, provider);

    const result = await service.compactSession({
      conversation: conversationWithHistory(),
      model: 'llama3.1',
    });

    expect(result.summary).toBe('## Current Work\nthe real summary');
    const persisted = result.conversation.messages[0]!.content;
    expect(persisted).not.toContain('analysis');
    expect(persisted).toContain('the real summary');
  });

  it('uses the configured compact prompt over the default', async () => {
    const repository = new InMemoryConversationRepository();
    const requests: ChatRequest[] = [];
    const provider: ProviderClient = {
      ...createProviderStub(),
      async sendChat(request: ChatRequest): Promise<ChatResult> {
        requests.push(request);
        return { content: 'summary' };
      },
    };
    const service = new ChatSessionService(repository, provider, {
      getCompactPrompt: () => 'Summarize briefly.',
    });

    await service.compactSession({
      conversation: conversationWithHistory(),
      model: 'llama3.1',
    });

    const last = requests[0]!.messages[requests[0]!.messages.length - 1]!;
    expect(last.content).toBe('Summarize briefly.');
  });
});
