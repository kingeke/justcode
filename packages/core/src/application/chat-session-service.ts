import {
  createConversation,
  type Conversation,
} from '@core/domain/conversation';
import { createMessage } from '@core/domain/message';
import type { ModelInfo, ProviderClient } from '@core/ports/chat-model';
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
}

export interface SubmitMessageResult {
  conversation: Conversation;
  reply: string;
}

export class ChatSessionService {
  public constructor(
    private readonly repository: ConversationRepository,
    private readonly provider: ProviderClient
  ) {}

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

  public async submitMessage(
    input: SubmitMessageInput
  ): Promise<SubmitMessageResult> {
    const trimmedContent = input.content.trim();

    if (!trimmedContent) {
      throw new Error('Message content cannot be empty.');
    }

    const userMessage = createMessage('user', trimmedContent);
    const response = await this.provider.sendChat({
      model: input.model,
      messages: [...input.conversation.messages, userMessage],
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
