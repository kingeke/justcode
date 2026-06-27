import { logModelsResponse } from '@providers/http/log-models';

import {
  ToolsUnsupportedError,
  type ChatRequest,
  type ChatResult,
  type ModelInfo,
  type ProviderClient,
  type ReasoningEffort,
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
import { sendResponsesRequest } from '@providers/openai/openai-responses-client';
import { supportsReasoningEffort } from '@providers/http/reasoning';

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
    /**
     * Copilot-only: the API surfaces this model is reachable through. Newer
     * GPT-5 models advertise only "/responses", which this chat-completions
     * client can't call (400 "unsupported_api_for_model"). Absent on plain
     * OpenAI/legacy models, which do work via /chat/completions.
     */
    supported_endpoints?: string[];
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

  /**
   * Per-model `supported_endpoints` learned from {@link listModels} (Copilot).
   * Used to route a turn to `/responses` for models that can't be reached via
   * `/chat/completions` (e.g. gpt-5.4-mini, gpt-5.5).
   */
  private readonly modelEndpoints = new Map<string, string[]>();

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
    if (this.usesResponsesApi(request.model)) {
      return this.sendResponsesChat(request);
    }
    try {
      return await this.sendChatCompletions(request);
    } catch (error) {
      // Some models (newer Copilot GPT-5s) are only served via /responses and
      // reject /chat/completions with `unsupported_api_for_model`. Remember
      // that and retry on the Responses API so the turn still succeeds.
      if (isUnsupportedApiForModelError(error)) {
        this.modelEndpoints.set(request.model, ['/responses']);
        return this.sendResponsesChat(request);
      }
      throw error;
    }
  }

  /**
   * True when the model advertises `/responses` but not `/chat/completions`.
   * Unknown models (no listing yet) default to `/chat/completions`, with a
   * fallback in {@link sendChatRequest} if the server rejects it.
   */
  private usesResponsesApi(model: string): boolean {
    const endpoints = this.modelEndpoints.get(model);
    if (!endpoints) return false;
    return (
      endpoints.includes('/responses') &&
      !endpoints.includes('/chat/completions')
    );
  }

  private async sendResponsesChat(request: ChatRequest): Promise<ChatResult> {
    return sendResponsesRequest({
      baseUrl: this.options.baseUrl,
      headers: {
        ...(await this.createHeaders()),
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      request,
      providerId: String(this.providerId),
    });
  }

  private async sendChatCompletions(request: ChatRequest): Promise<ChatResult> {
    const messages = toOpenAiWireMessages(request.messages);
    const tools = toOpenAiToolDefinitions(request.tools);
    // Only reasoning-capable models accept `reasoning_effort`; sending it to a
    // plain chat model 400s, so gate on the model id and omit otherwise.
    const reasoningParam: { reasoning_effort?: ReasoningEffort } =
      request.reasoningEffort &&
      request.reasoningEffort !== 'off' &&
      supportsReasoningEffort(request.model)
        ? { reasoning_effort: request.reasoningEffort }
        : {};

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
            ...reasoningParam,
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
          ...reasoningParam,
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

    // Remember each model's reachable endpoints so sendChat can route to
    // /responses for models that don't accept /chat/completions.
    this.modelEndpoints.clear();
    for (const model of response.data ?? []) {
      if (model.supported_endpoints) {
        this.modelEndpoints.set(model.id, model.supported_endpoints);
      }
    }

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

/**
 * Detects Copilot's 400 for models served only via the Responses API
 * (`unsupported_api_for_model` / "not accessible via the /chat/completions
 * endpoint"), so the turn can be retried on /responses.
 */
function isUnsupportedApiForModelError(error: unknown): boolean {
  if (!(error instanceof HttpError) || error.status !== 400) {
    return false;
  }

  const body = error.responseText.toLowerCase();
  return (
    body.includes('unsupported_api_for_model') ||
    body.includes('not accessible via the /chat/completions')
  );
}
