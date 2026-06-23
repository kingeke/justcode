import { describe, expect, it } from 'vitest';
import { ChatSessionService } from '@core/application/chat-session-service';
import { ToolRegistry } from '@core/application/tool-registry';
import { createConversation } from '@core/domain/conversation';
import {
  ProviderId,
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

describe('ChatSessionService', () => {
  it('loads available models and picks the first model when none is requested', async () => {
    const service = new ChatSessionService(
      new InMemoryConversationRepository(),
      createProviderStub()
    );

    const session = await service.startSession({ sessionId: 'session-1' });

    expect(session.activeModel).toBe('llama3.1');
    expect(session.availableModels).toEqual([
      { id: 'llama3.1', displayName: 'llama3.1' },
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
