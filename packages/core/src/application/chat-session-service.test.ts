import { describe, expect, it } from 'vitest';
import { ChatSessionService } from '@core/application/chat-session-service';
import { ToolRegistry } from '@core/application/tool-registry';
import { createConversation } from '@core/domain/conversation';
import {
  ProviderId,
  ToolsUnsupportedError,
  type ChatRequest,
  type ChatResult,
  type ProviderClient,
} from '@core/ports/chat-model';
import type { ConversationRepository } from '@core/ports/conversation-repository';
import type { Tool } from '@core/ports/tool';

class InMemoryConversationRepository implements ConversationRepository {
  public conversation = createConversation('session-1');

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
        return [{ id: 'gemma', displayName: 'gemma', providerId: ProviderId.Ollama }];
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
