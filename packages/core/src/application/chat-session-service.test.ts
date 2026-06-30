import { describe, expect, it } from 'vitest';
import {
  ChatSessionService,
  describeTool,
} from '@core/application/chat-session-service';
import { ToolRegistry } from '@core/application/tool-registry';
import { createConversation } from '@core/domain/conversation';
import { createMessage } from '@core/domain/message';
import {
  ToolsUnsupportedError,
  type ChatRequest,
  type ChatResult,
  type ProviderClient,
} from '@core/ports/chat-model';
import { ProviderId } from '@core/ports/provider-catalog';
import type { ConversationRepository } from '@core/ports/conversation-repository';
import type { Tool } from '@core/ports/tool';
import { LazyLoadToolsTool } from '@runtime/tools/lazy-load-tools-tool';
import type { WorkspaceFilePort } from '@core/ports/workspace-file-port';

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
  let callCount = 0;
  return {
    providerId: ProviderId.Ollama,
    async sendChat({ messages }): Promise<ChatResult> {
      callCount += 1;
      if (callCount === 1) {
        return { content: 'reply:Hello there' };
      }

      expect(messages.map((message) => message.role)).toEqual([
        'system',
        'user',
      ]);
      return { content: 'Project Planning' };
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

describe('ChatSessionService', () => {
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
      conversation: started.conversation,
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
        createMessage('user', 'm1'),
        createMessage('assistant', 'm2'),
        createMessage('user', 'm3'),
        createMessage('assistant', 'm4'),
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

  it('generates and saves a session title in the background after the first turn', async () => {
    const repository = new InMemoryConversationRepository();
    const service = new ChatSessionService(
      repository,
      createTitleGeneratingProvider()
    );

    const startedSession = await service.startSession({
      sessionId: 'session-1',
    });

    let resolveTitle: (title: string) => void;
    const titlePromise = new Promise<string>((resolve) => {
      resolveTitle = resolve;
    });

    const result = await service.submitMessage({
      conversation: startedSession.conversation,
      model: startedSession.activeModel,
      content: 'Hello there',
      onTitle: (_sessionId, title) => resolveTitle(title),
    });

    // The turn returns immediately; the title arrives later via onTitle so it
    // never blocks the user's next message.
    expect(result.conversation.title).toBeUndefined();

    const title = await titlePromise;
    expect(title).toMatch(/^Project Planning$/);
    expect(repository.conversation.title).toBe(title);
  });

  it('frames the title request as data and sanitizes a runaway reply', async () => {
    const repository = new InMemoryConversationRepository();
    let titleUserMessage: string | undefined;
    let callCount = 0;
    const provider: ProviderClient = {
      providerId: ProviderId.Ollama,
      async sendChat({ messages }): Promise<ChatResult> {
        callCount += 1;
        if (callCount === 1) {
          return { content: 'reply:sure' };
        }
        titleUserMessage = messages.find((m) => m.role === 'user')?.content;
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
      conversation: createConversation('session-1'),
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
      conversation: createConversation('session-1'),
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

    await expect(submitPromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(repository.conversation.messages).toHaveLength(0);
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
      conversation: createConversation('session-1'),
      model: 'gpt',
      content: 'create a.txt',
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
      conversation: createConversation('session-1'),
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
      conversation: createConversation('session-1'),
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
      conversation: createConversation('session-1'),
      model: 'gpt',
      content: 'create a.txt',
      requestApproval: async () => false,
    });

    expect(tool.executed).toEqual([]);
    expect(result.reply).toBe('All done.');
    expect(result.conversation.messages[2]?.content).toContain('rejected');
  });

  it('starts with lazy_load_tools only, then exposes full tools after loading', async () => {
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
      conversation: createConversation('session-1'),
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
    // After loading, the real tools are advertised — and the gateway stays in the
    // set so the model can call it again for a refreshed list.
    expect(seenRequests[1]?.map((tool) => tool.name)).toEqual([
      'lazy_load_tools',
      'write_file',
    ]);
    expect(approvals).toEqual(['write_file']);
    expect(delegatedTool.executed).toEqual(['{"path":"a.txt","content":"hi"}']);
    expect(result.reply).toBe('All done.');
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
        // First the model loads the toolset via the gateway, then it stops.
        if (turn === 1) {
          return {
            content: '',
            toolCalls: [
              { id: 'call-discover', name: 'lazy_load_tools', arguments: '{}' },
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

    await service.submitMessage({
      conversation: createConversation('session-1'),
      model: 'gpt',
      content: 'do something',
      requestApproval: async () => true,
    });

    // The request right after the gateway runs carries the real toolset minus
    // the disabled write_file. The gateway stays in so the model can re-call it.
    const postLoad = seenRequests[1]?.map((tool) => tool.name);
    expect(postLoad).toContain('read_file');
    expect(postLoad).not.toContain('write_file');
    expect(postLoad).toContain('lazy_load_tools');
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
      conversation: createConversation('session-1'),
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
      conversation: createConversation('session-1'),
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

  it('keeps the real tool set (with the gateway) on later turns once lazy_load_tools has run', async () => {
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
        // First turn loads tools, every later turn just replies.
        if (turn === 1) {
          return {
            content: '',
            toolCalls: [
              { id: 'call-discover', name: 'lazy_load_tools', arguments: '{}' },
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
      conversation: createConversation('session-1'),
      model: 'gpt',
      content: 'discover',
    });

    // Reusing the same conversation, the next turn must advertise the real tools
    // up front instead of falling back to the gateway-only view — and the gateway
    // stays in the set so the model can call it again for a refreshed list.
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
      conversation: createConversation('session-1'),
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
