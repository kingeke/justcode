import {
  ProviderId,
  type ChatRequest,
  type ChatResult,
  type ModelInfo,
  type ProviderClient,
} from '@core/ports/chat-model';
import {
  joinUrl,
  requestJson,
  requestSseStream,
} from '@providers/http/http-client';
import {
  parseOpenAiToolCalls,
  toOpenAiToolDefinitions,
  toOpenAiWireMessages,
  type RawOpenAiToolCall,
} from '@providers/openai-compatible/openai-wire';

interface OpenRouterModelsResponse {
  data?: Array<{
    id: string;
    name?: string;
    context_length?: number;
    pricing?: {
      prompt?: string | number;
      completion?: string | number;
      input_cache_read?: string | number;
      input_cache_write?: string | number;
    };
  }>;
}

interface OpenRouterChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
      tool_calls?: RawOpenAiToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export class OpenRouterProvider implements ProviderClient {
  public readonly providerId = ProviderId.OpenRouter;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  public constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl ?? 'https://openrouter.ai/api/v1';
  }

  public getDefaultModel(): string | undefined {
    return undefined;
  }

  public async sendChat(request: ChatRequest): Promise<ChatResult> {
    const messages = toOpenAiWireMessages(request.messages);
    const tools = toOpenAiToolDefinitions(request.tools);
    const headers = {
      authorization: `Bearer ${this.apiKey}`,
      'content-type': 'application/json',
    };

    if (request.onToken) {
      let accumulated = '';
      const { usage: streamUsage, toolCalls } = await requestSseStream(
        joinUrl(this.baseUrl, '/chat/completions'),
        {
          method: 'POST',
          headers,
          body: {
            model: request.model,
            messages,
            stream: true,
            stream_options: { include_usage: true },
            ...(tools ? { tools, tool_choice: 'auto' } : {}),
          },
        },
        (token) => {
          accumulated += token;
          request.onToken!(token);
        },
        request.onThinkingToken
      );

      if (!accumulated.trim() && toolCalls.length === 0) {
        throw new Error(`Provider 'openrouter' returned an empty response.`);
      }

      return {
        content: accumulated,
        ...(streamUsage.inputTokens > 0 ? { usage: streamUsage } : {}),
        ...(toolCalls.length ? { toolCalls } : {}),
      };
    }

    const response = await requestJson<OpenRouterChatResponse>(
      joinUrl(this.baseUrl, '/chat/completions'),
      {
        method: 'POST',
        headers,
        body: {
          model: request.model,
          messages,
          stream: false,
          ...(tools ? { tools, tool_choice: 'auto' } : {}),
        },
      }
    );

    const content = response.choices?.[0]?.message?.content;
    const toolCalls = parseOpenAiToolCalls(
      response.choices?.[0]?.message?.tool_calls
    );
    const usage = response.usage
      ? {
          inputTokens: response.usage.prompt_tokens ?? 0,
          outputTokens: response.usage.completion_tokens ?? 0,
          cachedTokens: 0,
        }
      : undefined;
    const extraSpread = {
      ...(usage ? { usage } : {}),
      ...(toolCalls.length ? { toolCalls } : {}),
    };

    if (typeof content === 'string' && content.trim()) {
      return { content, ...extraSpread };
    }

    if (toolCalls.length) {
      return { content: '', ...extraSpread };
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

    return (response.data ?? [])
      .filter((m) => m.context_length != null)
      .map((model) => ({
        id: model.id,
        displayName: model.name ?? model.id,
        providerId: ProviderId.OpenRouter,
        ...(model.context_length != null
          ? { contextWindow: model.context_length }
          : {}),
        ...(model.pricing
          ? {
              pricing: {
                inputPerToken: Number(model.pricing.prompt ?? 0),
                outputPerToken: Number(model.pricing.completion ?? 0),
                ...(model.pricing.input_cache_read != null
                  ? {
                      cacheReadPerToken: Number(model.pricing.input_cache_read),
                    }
                  : {}),
                ...(model.pricing.input_cache_write != null
                  ? {
                      cacheWritePerToken: Number(
                        model.pricing.input_cache_write
                      ),
                    }
                  : {}),
              },
            }
          : {}),
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }
}
