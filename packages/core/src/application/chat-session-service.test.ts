import { describe, expect, it } from 'vitest';
import { ChatSessionService } from '@core/application/chat-session-service';
import { ToolRegistry } from '@core/application/tool-registry';
import { createConversation } from '@core/domain/conversation';
import {
  ToolsUnsupportedError,
  type ChatRequest,
  type ChatResult,
  type ProviderClient,
} from '@core/ports/chat-model';
import { ProviderId } from '@core/ports/provider-catalog';
import type { ConversationRepository } from '@core/ports/conversation-repository';
import type { Tool } from '@core/ports/tool';
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

/** Returns a tool call on the first turn, then a final answer. */
function createToolCallingProvider(): ProviderClient {
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
              name: 'write_file',
              arguments: '{"path":"a.txt","content":"hi"}',
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
});
