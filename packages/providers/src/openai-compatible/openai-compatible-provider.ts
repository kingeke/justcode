import type {
  ChatRequest,
  ChatResult,
  ModelInfo,
  ModelPricing,
  ProviderClient,
  ProviderId,
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
      tool_calls?: RawOpenAiToolCall[];
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

// Prices in USD per token. Source: https://openai.com/api/pricing/
const OPENAI_PRICING: Record<string, ModelPricing> = {
  'gpt-4o': {
    inputPerToken: 0.0000025,
    outputPerToken: 0.00001,
    cacheReadPerToken: 0.00000125,
  },
  'gpt-4o-mini': {
    inputPerToken: 0.00000015,
    outputPerToken: 0.0000006,
    cacheReadPerToken: 0.000000075,
  },
  'gpt-4-turbo': { inputPerToken: 0.00001, outputPerToken: 0.00003 },
  'gpt-4': { inputPerToken: 0.00003, outputPerToken: 0.00006 },
  'gpt-3.5-turbo': { inputPerToken: 0.0000005, outputPerToken: 0.0000015 },
  o1: {
    inputPerToken: 0.000015,
    outputPerToken: 0.00006,
    cacheReadPerToken: 0.0000075,
  },
  'o1-mini': {
    inputPerToken: 0.000003,
    outputPerToken: 0.000012,
    cacheReadPerToken: 0.0000015,
  },
  'o1-preview': { inputPerToken: 0.000015, outputPerToken: 0.00006 },
  'o3-mini': {
    inputPerToken: 0.0000011,
    outputPerToken: 0.0000044,
    cacheReadPerToken: 0.00000055,
  },
  o3: {
    inputPerToken: 0.00001,
    outputPerToken: 0.00004,
    cacheReadPerToken: 0.0000025,
  },
};

const OPENAI_CONTEXT_WINDOWS: Record<string, number> = {
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4': 8_192,
  'gpt-3.5-turbo': 16_385,
  o1: 200_000,
  'o1-mini': 128_000,
  'o1-preview': 128_000,
  'o3-mini': 200_000,
  o3: 200_000,
};

export class OpenAiCompatibleProvider implements ProviderClient {
  public readonly providerId: ProviderId;

  public constructor(
    private readonly options: OpenAiCompatibleProviderOptions
  ) {
    this.providerId = options.providerId;
  }

  public async sendChat(request: ChatRequest): Promise<ChatResult> {
    const messages = toOpenAiWireMessages(request.messages);
    const tools = toOpenAiToolDefinitions(request.tools);

    if (request.onToken) {
      let accumulated = '';
      let reasoning = '';
      const { usage: streamUsage, toolCalls } = await requestSseStream(
        joinUrl(this.options.baseUrl, '/chat/completions'),
        {
          method: 'POST',
          headers: this.createHeaders(),
          ...(request.signal ? { signal: request.signal } : {}),
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
        (token) => {
          reasoning += token;
          request.onThinkingToken?.(token);
        }
      );

      // Reasoning models (e.g. gpt-oss) sometimes emit their whole turn on the
      // reasoning channel and finish with empty content. Treat the reasoning as
      // the answer rather than failing the turn.
      const content = accumulated.trim() ? accumulated : reasoning;
      if (!content.trim() && toolCalls.length === 0) {
        throw new Error(
          `Provider '${this.providerId}' returned an empty response.`
        );
      }

      return {
        content,
        ...(streamUsage.inputTokens > 0 ? { usage: streamUsage } : {}),
        ...(toolCalls.length ? { toolCalls } : {}),
      };
    }

    const response = await requestJson<OpenAiChatResponse>(
      joinUrl(this.options.baseUrl, '/chat/completions'),
      {
        method: 'POST',
        headers: this.createHeaders(),
        ...(request.signal ? { signal: request.signal } : {}),
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
          cachedTokens:
            response.usage.prompt_tokens_details?.cached_tokens ?? 0,
        }
      : undefined;

    const extraSpread = {
      ...(usage ? { usage } : {}),
      ...(toolCalls.length ? { toolCalls } : {}),
    };

    if (typeof content === 'string' && content.trim()) {
      return { content, ...extraSpread };
    }

    if (Array.isArray(content)) {
      const mergedContent = content
        .map((part) => part.text ?? '')
        .join('')
        .trim();

      if (mergedContent) {
        return { content: mergedContent, ...extraSpread };
      }
    }

    if (toolCalls.length) {
      return { content: '', ...extraSpread };
    }

    throw new Error(
      `Provider '${this.providerId}' returned an empty response.`
    );
  }

  public async listModels(): Promise<ModelInfo[]> {
    const response = await requestJson<OpenAiModelsResponse>(
      joinUrl(this.options.baseUrl, '/models'),
      {
        headers: this.createHeaders(),
      }
    );

    return (response.data ?? [])
      .map((model) => {
        const contextWindow = this.resolveContextWindow(model.id);
        const pricing = this.resolvePricing(model.id);
        return {
          id: model.id,
          displayName: model.id,
          providerId: this.providerId,
          ...(contextWindow != null ? { contextWindow } : {}),
          ...(pricing ? { pricing } : {}),
        };
      })
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

  protected resolveContextWindow(modelId: string): number | undefined {
    return OPENAI_CONTEXT_WINDOWS[modelId];
  }

  protected resolvePricing(modelId: string): ModelPricing | undefined {
    return OPENAI_PRICING[modelId];
  }
}
