import {
  createConversation,
  type Conversation,
} from '@core/domain/conversation';
import { createMessage, type MessageAttachment } from '@core/domain/message';
import type { ModelInfo, ProviderClient, TokenUsage } from '@core/ports/chat-model';
import type { ConversationRepository } from '@core/ports/conversation-repository';

export interface StartSessionInput {
  sessionId: string;
  requestedModel?: string;
}

export interface StartSessionResult {
  conversation: Conversation;
  activeModel: string;
  availableModels: ModelInfo[];
}

export interface SubmitMessageInput {
  conversation: Conversation;
  model: string;
  content: string;
  attachments?: MessageAttachment[];
  onToken?: (token: string) => void;
}

export interface SubmitMessageResult {
  conversation: Conversation;
  reply: string;
  usage?: TokenUsage;
}

export class ChatSessionService {
  private provider: ProviderClient;

  public constructor(
    private readonly repository: ConversationRepository,
    provider: ProviderClient
  ) {
    this.provider = provider;
  }

  public switchProvider(provider: ProviderClient): void {
    this.provider = provider;
  }

  public async startSession(
    input: StartSessionInput
  ): Promise<StartSessionResult> {
    const conversation = await this.repository.load(input.sessionId);
    const availableModels = await this.provider.listModels();
    const activeModel = this.resolveModel(
      input.requestedModel,
      availableModels
    );

    return {
      conversation,
      activeModel,
      availableModels,
    };
  }

  public async clearSession(sessionId: string): Promise<Conversation> {
    await this.repository.clear(sessionId);
    return createConversation(sessionId);
  }

  public async submitMessage(
    input: SubmitMessageInput
  ): Promise<SubmitMessageResult> {
    const trimmedContent = input.content.trim();

    if (!trimmedContent) {
      throw new Error('Message content cannot be empty.');
    }

    const userMessage = createMessage(
      'user',
      trimmedContent,
      new Date(),
      input.attachments
    );
    const response = await this.provider.sendChat({
      model: input.model,
      messages: [...input.conversation.messages, userMessage],
      ...(input.onToken ? { onToken: input.onToken } : {}),
    });
    const assistantMessage = createMessage('assistant', response.content);
    const updatedConversation: Conversation = {
      ...input.conversation,
      messages: [...input.conversation.messages, userMessage, assistantMessage],
      updatedAt: assistantMessage.createdAt,
    };

    await this.repository.save(updatedConversation);

    return {
      conversation: updatedConversation,
      reply: assistantMessage.content,
      ...(response.usage ? { usage: response.usage } : {}),
    };
  }

  private resolveModel(
    requestedModel: string | undefined,
    availableModels: ModelInfo[]
  ): string {
    if (requestedModel) {
      return requestedModel;
    }

    const providerDefault = this.provider.getDefaultModel();
    if (providerDefault) {
      return providerDefault;
    }

    const firstModel = availableModels[0]?.id;
    if (firstModel) {
      return firstModel;
    }

    throw new Error(
      `No models are available for provider '${this.provider.providerId}'.`
    );
  }
}

export function createEmptyConversation(sessionId: string): Conversation {
  return createConversation(sessionId);
}
