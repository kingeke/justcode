import type { ChatRequest, ChatResult, ModelInfo, OpenRouterProviderClient } from '@core/ports/chat-model';
import { renderMessageContentForModel } from '@core/domain/message';
import { joinUrl, requestJson, requestSseStream } from '@providers/http/http-client';

interface OpenRouterModelsResponse {
  data?: Array<{
    id: string;
    name?: string;
    context_length?: number;
    pricing?: {
      prompt?: number;
      completion?: number;
    };
  }>;
}

interface OpenRouterChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export class OpenRouterProvider implements OpenRouterProviderClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  public constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl ?? 'https://openrouter.ai/api/v1';
  }

  public async sendChat(request: ChatRequest): Promise<ChatResult> {
    const messages = request.messages.map((message) => ({
      role: message.role,
      content: renderMessageContentForModel(message),
    }));
    const headers = {
      authorization: `Bearer ${this.apiKey}`,
      'content-type': 'application/json',
    };

    if (request.onToken) {
      let accumulated = '';
      await requestSseStream(
        joinUrl(this.baseUrl, '/chat/completions'),
        {
          method: 'POST',
          headers,
          body: { model: request.model, messages, stream: true },
        },
        (token) => {
          accumulated += token;
          request.onToken!(token);
        }
      );

      if (!accumulated.trim()) {
        throw new Error(`Provider 'openrouter' returned an empty response.`);
      }

      return { content: accumulated };
    }

    const response = await requestJson<OpenRouterChatResponse>(
      joinUrl(this.baseUrl, '/chat/completions'),
      {
        method: 'POST',
        headers,
        body: { model: request.model, messages, stream: false },
      }
    );

    const content = response.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim()) {
      return { content };
    }

    throw new Error(`Provider 'openrouter' returned an empty response.`);
  }

  public async listModels(): Promise<ModelInfo[]> {
    const response = await requestJson<OpenRouterModelsResponse>(
      joinUrl(this.baseUrl, '/models'),
       {
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
         },
       }
    );

     const modelsWithLength = (response.data ?? []).filter(
        (model) => model.context_length !== undefined && model.context_length !== null
      );

     return modelsWithLength
        .map((model) => ({
         id: model.id,
         displayName: model.name ?? model.id,
         contextLength: model.context_length,
         pricing: model.pricing,
        }))
        .sort((left, right) => left.id.localeCompare(right.id));
  }
}
