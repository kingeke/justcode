import { logModelsResponse } from '@providers/http/log-models';

import {
  ToolsUnsupportedError,
  type ChatRequest,
  type ChatResult,
  type ModelInfo,
  type ProviderClient,
} from '@core/ports/chat-model';
import { type ProviderId } from '@core/ports/provider-catalog';
import {
  HttpError,
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
  /**
   * Resolves a fresh OAuth access token per request (refreshing on expiry).
   * When set it takes precedence over {@link apiKey} for the bearer header.
   */
  getAccessToken?: () => Promise<string>;
  /** Extra headers sent on every request (e.g. Copilot integration headers). */
  extraHeaders?: Record<string, string>;
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
    cost?: number;
  };
}


export class OpenAiCompatibleProvider implements ProviderClient {
  public readonly providerId: ProviderId;

  public constructor(
    private readonly options: OpenAiCompatibleProviderOptions
  ) {
    this.providerId = options.providerId;
  }

  public async sendChat(request: ChatRequest): Promise<ChatResult> {
    try {
      return await this.sendChatRequest(request);
    } catch (error) {
      // Surface "model doesn't support tools" 400s as a typed error so the
      // agent loop can retry the model in chat-only mode.
      if (request.tools?.length && isToolsUnsupportedError(error)) {
        throw new ToolsUnsupportedError(
          error instanceof Error ? error.message : String(error)
        );
      }
      throw error;
    }
  }

  private async sendChatRequest(request: ChatRequest): Promise<ChatResult> {
    const messages = toOpenAiWireMessages(request.messages);
    const tools = toOpenAiToolDefinitions(request.tools);

    if (request.onToken) {
      let accumulated = '';
      let reasoning = '';
      const { usage: streamUsage, toolCalls } = await requestSseStream(
        joinUrl(this.options.baseUrl, '/chat/completions'),
        {
          method: 'POST',
          headers: await this.createHeaders(),
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
        headers: await this.createHeaders(),
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
        headers: await this.createHeaders(),
      }
    );

    void logModelsResponse(String(this.providerId), response);

    return (response.data ?? [])
      .map((model) => ({
        id: model.id,
        displayName: model.id,
        providerId: this.providerId,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  public getDefaultModel(): string | undefined {
    return this.options.defaultModel;
  }

  protected async createHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { ...this.options.extraHeaders };

    if (this.options.getAccessToken) {
      headers.authorization = `Bearer ${await this.options.getAccessToken()}`;
    } else if (this.options.apiKey) {
      headers.authorization = `Bearer ${this.options.apiKey}`;
    }

    return headers;
  }

}

/**
 * Detects a 400 that means the model rejected tool/function calling (e.g.
 * Ollama's "<model> does not support tools"). Matched on the response body so
 * we don't misclassify unrelated 400s.
 */
function isToolsUnsupportedError(error: unknown): boolean {
  if (!(error instanceof HttpError) || error.status !== 400) {
    return false;
  }

  const body = error.responseText.toLowerCase();
  return (
    body.includes('does not support tools') ||
    body.includes('does not support tool') ||
    (body.includes('tool') && body.includes('not supported')) ||
    (body.includes('function calling') && body.includes('not'))
  );
}
