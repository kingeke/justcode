import type {
  ChatRequest,
  ChatResult,
  ModelInfo,
  ProviderClient,
} from '@core/ports/chat-model';
import { renderMessageContentForModel } from '@core/domain/message';
import { joinUrl, requestJson } from '@providers/http/http-client';

interface OllamaTagsResponse {
  models?: Array<{
    name: string;
  }>;
}

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
}

export class OllamaProvider implements ProviderClient {
  public readonly providerId = 'ollama' as const;

  public constructor(private readonly baseUrl: string) {}

  public async sendChat(request: ChatRequest): Promise<ChatResult> {
    const response = await requestJson<OllamaChatResponse>(
      joinUrl(this.baseUrl, '/api/chat'),
      {
        method: 'POST',
        body: {
          model: request.model,
          messages: request.messages.map((message) => ({
            role: message.role,
            content: renderMessageContentForModel(message),
          })),
          stream: false,
        },
      }
    );

    const content = response.message?.content?.trim();
    if (!content) {
      throw new Error('Ollama returned an empty response.');
    }

    return { content };
  }

  public async listModels(): Promise<ModelInfo[]> {
    const response = await requestJson<OllamaTagsResponse>(
      joinUrl(this.baseUrl, '/api/tags')
    );

    return (response.models ?? [])
      .map((model) => ({ id: model.name, displayName: model.name }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  public getDefaultModel(): string | undefined {
    return undefined;
  }
}
