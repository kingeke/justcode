import type {
  ChatRequest,
  ChatResult,
  ModelInfo,
  ProviderClient,
  ProviderId,
} from '@core/ports/chat-model';
import { renderMessageContentForModel } from '@core/domain/message';
import { joinUrl, requestJson, requestSseStream } from '@providers/http/http-client';

interface OpenAiCompatibleProviderOptions {
  providerId: ProviderId;
  baseUrl: string;
  apiKey?: string;
  defaultModel?: string;
}

interface OpenAiModelsResponse {
  data?: Array<{
    id: string;
  }>;
}

interface OpenAiChatResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type: string; text?: string }>;
    };
  }>;
}

export class OpenAiCompatibleProvider implements ProviderClient {
  public readonly providerId: ProviderId;

  public constructor(
    private readonly options: OpenAiCompatibleProviderOptions
  ) {
    this.providerId = options.providerId;
  }

  public async sendChat(request: ChatRequest): Promise<ChatResult> {
    const messages = request.messages.map((message) => ({
      role: message.role,
      content: renderMessageContentForModel(message),
    }));

    if (request.onToken) {
      let accumulated = '';
      await requestSseStream(
        joinUrl(this.options.baseUrl, '/chat/completions'),
        {
          method: 'POST',
          headers: this.createHeaders(),
          body: { model: request.model, messages, stream: true },
        },
        (token) => {
          accumulated += token;
          request.onToken!(token);
        }
      );

      if (!accumulated.trim()) {
        throw new Error(`Provider '${this.providerId}' returned an empty response.`);
      }

      return { content: accumulated };
    }

    const response = await requestJson<OpenAiChatResponse>(
      joinUrl(this.options.baseUrl, '/chat/completions'),
      {
        method: 'POST',
        headers: this.createHeaders(),
        body: { model: request.model, messages, stream: false },
      }
    );

    const content = response.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim()) {
      return { content };
    }

    if (Array.isArray(content)) {
      const mergedContent = content
        .map((part) => part.text ?? '')
        .join('')
        .trim();

      if (mergedContent) {
        return { content: mergedContent };
      }
    }

    throw new Error(`Provider '${this.providerId}' returned an empty response.`);
  }

  public async listModels(): Promise<ModelInfo[]> {
    const response = await requestJson<OpenAiModelsResponse>(
      joinUrl(this.options.baseUrl, '/models'),
      {
        headers: this.createHeaders(),
      }
    );

    return (response.data ?? [])
      .map((model) => ({ id: model.id, displayName: model.id }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  public getDefaultModel(): string | undefined {
    return this.options.defaultModel;
  }

  protected createHeaders(): Record<string, string> {
    if (!this.options.apiKey) {
      return {};
    }

    return {
      authorization: `Bearer ${this.options.apiKey}`,
    };
  }
}
