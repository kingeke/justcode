import { describe, expect, it } from 'vitest';
import { ChatSessionService } from '@core/application/chat-session-service';
import { createConversation } from '@core/domain/conversation';
import { ProviderId, type ProviderClient } from '@core/ports/chat-model';
import type { ConversationRepository } from '@core/ports/conversation-repository';

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
      return [{ id: 'llama3.1', displayName: 'llama3.1', providerId: ProviderId.Ollama }];
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
});
