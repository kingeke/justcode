import {
  ProviderId,
  type ChatRequest,
  type ChatResult,
  type ModelInfo,
  type ProviderClient,
} from '@core/ports/chat-model';
import { renderMessageContentForModel } from '@core/domain/message';
import {
  HttpError,
  joinUrl,
  requestJson,
  requestNdjsonStream,
  type SseUsage,
} from '@providers/http/http-client';

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
  public readonly providerId = ProviderId.Ollama;

  public constructor(private readonly baseUrl: string) {}

  public async sendChat(request: ChatRequest): Promise<ChatResult> {
    const messages = request.messages.map((message) => ({
      role: message.role,
      content: renderMessageContentForModel(message),
    }));

    if (request.onToken) {
      let accumulated = '';
      // Ollama rejects `think: true` for models that don't support reasoning,
      // so retry without it if the first attempt is refused.
      const runStream = (think: boolean): Promise<SseUsage> =>
        requestNdjsonStream(
          joinUrl(this.baseUrl, '/api/chat'),
          {
            method: 'POST',
            body: { model: request.model, messages, stream: true, ...(think ? { think: true } : {}) },
          },
          (token) => {
            accumulated += token;
            request.onToken!(token);
          },
          request.onThinkingToken
        );

      const streamUsage = await runStream(true).catch((error: unknown) => {
        if (error instanceof HttpError && error.status === 400) {
          accumulated = '';
          return runStream(false);
        }
        throw error;
      });

      if (!accumulated.trim()) {
        throw new Error('Ollama returned an empty response.');
      }

      return {
        content: accumulated,
        ...(streamUsage.inputTokens > 0 ? { usage: streamUsage } : {}),
      };
    }

    const response = await requestJson<OllamaChatResponse>(
      joinUrl(this.baseUrl, '/api/chat'),
      {
        method: 'POST',
        body: { model: request.model, messages, stream: false },
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
      .map((model) => ({ id: model.name, displayName: model.name, providerId: ProviderId.Ollama }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  public getDefaultModel(): string | undefined {
    return undefined;
  }
}
