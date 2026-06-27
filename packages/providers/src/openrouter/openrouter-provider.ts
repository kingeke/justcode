import { logModelsResponse } from '@providers/http/log-models';

import {
  type ChatRequest,
  type ChatResult,
  type ModelInfo,
  type ModelReasoning,
  type ProviderClient,
} from '@core/ports/chat-model';
import {
  normalizeEffortLevels,
  toReasoningEffort,
} from '@providers/http/reasoning';
import { ProviderId } from '@core/ports/provider-catalog';
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
    /**
     * Per-model reasoning capability. Present only for models that reason;
     * `mandatory` models always reason (effort can't be disabled), and
     * `supported_efforts` is the exact set of levels the model accepts.
     */
    reasoning?: {
      mandatory?: boolean;
      supported_efforts?: string[];
      default_effort?: string;
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
    prompt_tokens_details?: { cached_tokens?: number };
    cost?: number;
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
    // OpenRouter's unified `reasoning` param is normalized server-side and
    // ignored for models that don't reason. `'off'` must be an explicit disable
    // (`enabled: false`) — omitting the param lets a default-reasoning model keep
    // reasoning.
    const reasoning =
      request.reasoningEffort === 'off'
        ? { reasoning: { enabled: false } }
        : request.reasoningEffort
          ? { reasoning: { effort: request.reasoningEffort } }
          : {};

    if (request.onToken) {
      let accumulated = '';
      const { usage: streamUsage, toolCalls } = await requestSseStream(
        joinUrl(this.baseUrl, '/chat/completions'),
        {
          method: 'POST',
          headers,
          ...(request.signal ? { signal: request.signal } : {}),
          body: {
            model: request.model,
            messages,
            stream: true,
            stream_options: { include_usage: true },
            ...reasoning,
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
        ...(request.signal ? { signal: request.signal } : {}),
        body: {
          model: request.model,
          messages,
          stream: false,
          ...reasoning,
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
          ...(response.usage.cost != null ? { cost: response.usage.cost } : {}),
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

    void logModelsResponse(ProviderId.OpenRouter, response);

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
        ...toModelReasoning(model.reasoning),
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }
}

/**
 * Translates OpenRouter's per-model reasoning block into the normalized
 * {@link ModelReasoning}. Returns an empty object (no capability) when the model
 * doesn't reason or advertises no usable effort levels.
 */
function toModelReasoning(
  reasoning:
    | {
        mandatory?: boolean;
        supported_efforts?: string[];
        default_effort?: string;
      }
    | undefined
): { reasoning?: ModelReasoning } {
  if (!reasoning?.supported_efforts?.length) return {};
  const effortLevels = normalizeEffortLevels(reasoning.supported_efforts);
  if (effortLevels.length === 0) return {};
  // Fall back to the lowest advertised level when the provider names no default,
  // so a reasoning model always has a concrete default to preselect/apply.
  const defaultEffort =
    toReasoningEffort(reasoning.default_effort) ?? effortLevels[0];
  return {
    reasoning: {
      effortLevels,
      mandatory: reasoning.mandatory ?? false,
      ...(defaultEffort ? { defaultEffort } : {}),
    },
  };
}
