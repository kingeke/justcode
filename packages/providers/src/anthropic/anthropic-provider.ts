import { logModelsResponse } from '@providers/http/log-models';

import {
  type ChatRequest,
  type ChatResult,
  type ModelInfo,
  type ProviderClient,
} from '@core/ports/chat-model';
import { ReasoningDisabled } from '@core/ports/chat-model';
import { ProviderId } from '@core/ports/provider-catalog';
import type { ToolCall } from '@core/domain/message';
import { HttpError, joinUrl, requestJson } from '@providers/http/http-client';
import { streamFetch } from '@providers/http/stream-dispatcher';
import { logRequestResponse } from '@core/application/debug-log';
import {
  parseAnthropicToolCalls,
  toAnthropicToolDefinitions,
  toAnthropicWireRequest,
  AnthropicBlockType,
  AnthropicDeltaType,
} from '@providers/anthropic/anthropic-wire';

export enum AnthropicStreamEventType {
  MessageStart = 'message_start',
  ContentBlockStart = 'content_block_start',
  ContentBlockDelta = 'content_block_delta',
  MessageDelta = 'message_delta',
}
import {
  requiresAdaptiveThinking,
  supportsThinking,
  thinkingBudgetTokens,
} from '@providers/http/reasoning';

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 8192;

/**
 * API-key access only. Claude Pro/Max subscription (OAuth) auth is deliberately
 * not supported here: Anthropic's Consumer Terms prohibit consumer OAuth tokens
 * outside the official Claude Code client. Subscription users go through the
 * Agent SDK-backed provider in `@providers/claude-code` instead.
 */
export interface AnthropicProviderOptions {
  baseUrl: string;
  apiKey?: string;
}

interface AnthropicModelsResponse {
  data?: Array<{
    id: string;
    display_name?: string;
    /** Context window size; the model picker shows this as "ctx". */
    max_input_tokens?: number;
  }>;
}

interface AnthropicMessageResponse {
  content?: Array<{
    type?: string;
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export class AnthropicProvider implements ProviderClient {
  public readonly providerId = ProviderId.Anthropic;

  public constructor(private readonly options: AnthropicProviderOptions) {}

  public async sendChat(request: ChatRequest): Promise<ChatResult> {
    const { system, messages } = toAnthropicWireRequest(request.messages);
    const tools = toAnthropicToolDefinitions(request.tools);
    // Thinking wire format is model-generation dependent. Fable/Mythos 5,
    // Opus 4.7+, and Sonnet 5 reject `enabled`/`budget_tokens` with a 400 —
    // they take `thinking: {type: 'adaptive'}` plus `output_config.effort`
    // (the effort names match justcode's ReasoningEffort values 1:1). Older
    // thinking models map effort to a token budget; Anthropic requires
    // max_tokens to exceed budget_tokens, so size the response cap to the
    // budget plus the default reply allowance. Models predating thinking
    // reject the block entirely, so gate on the model id.
    const thinkingEffort =
      request.reasoningEffort &&
      request.reasoningEffort !== ReasoningDisabled.Off
        ? request.reasoningEffort
        : undefined;
    const thinking =
      thinkingEffort && supportsThinking(request.model)
        ? requiresAdaptiveThinking(request.model)
          ? {
              thinking: { type: 'adaptive' as const },
              output_config: { effort: thinkingEffort },
              // No budget to add, but thinking output shares max_tokens with
              // the reply — keep the same headroom the budget path gets.
              max_tokens:
                thinkingBudgetTokens(thinkingEffort) + DEFAULT_MAX_TOKENS,
            }
          : {
              thinking: {
                type: 'enabled' as const,
                budget_tokens: thinkingBudgetTokens(thinkingEffort),
              },
              max_tokens:
                thinkingBudgetTokens(thinkingEffort) + DEFAULT_MAX_TOKENS,
            }
        : {};
    const body = {
      model: request.model,
      // Anthropic requires max_tokens on every request. When extended thinking
      // is enabled the spread below overrides this with budget + reply cap.
      max_tokens: DEFAULT_MAX_TOKENS,
      ...thinking,
      // Anthropic-only prompt caching: the top-level breakpoint auto-caches the
      // last cacheable block (the prefix shared across the agentic loop). Other
      // providers don't accept this field — applied here only.
      cache_control: { type: 'ephemeral' as const },
      ...(system ? { system } : {}),
      messages,
      ...(tools ? { tools } : {}),
    };

    if (request.onToken) {
      return this.streamChat(request, body);
    }

    const response = await requestJson<AnthropicMessageResponse>(
      joinUrl(this.options.baseUrl, '/v1/messages'),
      {
        method: 'POST',
        headers: await this.createHeaders(),
        // No deadline: chat is cancelled by the user's signal, and a fixed
        // clock only kills legitimately slow reasoning turns.
        timeoutMs: 0,
        ...(request.signal ? { signal: request.signal } : {}),
        body: { ...body, stream: false },
      }
    );

    const content = (response.content ?? [])
      .filter((block) => block.type === AnthropicBlockType.Text)
      .map((block) => block.text ?? '')
      .join('');
    const toolCalls = parseAnthropicToolCalls(response.content ?? []);
    const usage = response.usage
      ? {
          // Anthropic reports only the *uncached* prompt in `input_tokens`, with
          // the cached prefix broken out separately. Sum them so `inputTokens` is
          // the full context size (matching the total `prompt_tokens` other
          // providers report), while `cachedTokens` stays the cache-read subset.
          inputTokens:
            (response.usage.input_tokens ?? 0) +
            (response.usage.cache_read_input_tokens ?? 0) +
            (response.usage.cache_creation_input_tokens ?? 0),
          outputTokens: response.usage.output_tokens ?? 0,
          cachedTokens: response.usage.cache_read_input_tokens ?? 0,
        }
      : undefined;

    if (!content.trim() && toolCalls.length === 0) {
      throw new Error("Provider 'anthropic' returned an empty response.");
    }

    return {
      content,
      ...(usage ? { usage } : {}),
      ...(toolCalls.length ? { toolCalls } : {}),
    };
  }

  public async listModels(): Promise<ModelInfo[]> {
    const response = await requestJson<AnthropicModelsResponse>(
      joinUrl(this.options.baseUrl, '/v1/models?limit=1000'),
      { headers: await this.createHeaders() }
    );

    void logModelsResponse(String(this.providerId), response);

    return (response.data ?? [])
      .map((model) => {
        return {
          id: model.id,
          displayName: model.display_name ?? model.id,
          providerId: this.providerId,
          ...(model.max_input_tokens != null
            ? { contextWindow: model.max_input_tokens }
            : {}),
        };
      })
      .sort((left, right) => right.id.localeCompare(left.id));
  }

  public getDefaultModel(): string | undefined {
    return undefined;
  }

  private async streamChat(
    request: ChatRequest,
    body: Record<string, unknown>
  ): Promise<ChatResult> {
    const requestOptions: RequestInit = {
      method: 'POST',
      headers: {
        ...(await this.createHeaders()),
        accept: 'text/event-stream',
      },
      body: JSON.stringify({ ...body, stream: true }),
      ...(request.signal ? { signal: request.signal } : {}),
    };

    const url = joinUrl(this.options.baseUrl, '/v1/messages');
    const response = await streamFetch(url, requestOptions);
    if (!response.ok) {
      const responseText = await response.text();
      await logRequestResponse({
        request: {
          url,
          method: String(requestOptions.method),
          headers: requestOptions.headers as Record<string, string>,
          body,
        },
        response: {
          url,
          status: response.status,
          ok: response.ok,
          body: responseText,
        },
      });
      throw new HttpError(
        `Request to ${url} failed with status ${response.status}. ${responseText}`,
        response.status,
        responseText
      );
    }
    if (!response.body) throw new Error('Response body is null.');

    const accumulator = new AnthropicStreamAccumulator(
      request.onToken,
      request.onThinkingToken
    );
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice('data:'.length).trim();
        if (!data) continue;
        try {
          accumulator.handle(JSON.parse(data));
        } catch {
          // skip malformed SSE payloads
        }
      }
    }

    const result = accumulator.toResult();
    await logRequestResponse({
      request: {
        url,
        method: String(requestOptions.method),
        headers: requestOptions.headers as Record<string, string>,
        body,
      },
      // Log the reconstructed result (plus streamed thinking) rather than the
      // raw SSE transcript, which is enormous and unreadable once escaped.
      response: {
        url,
        status: response.status,
        ok: true,
        body: accumulator.reasoning
          ? { ...result, reasoning: accumulator.reasoning }
          : result,
      },
    });
    return result;
  }

  private async createHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'anthropic-version': ANTHROPIC_VERSION,
    };

    if (this.options.apiKey) {
      headers['x-api-key'] = this.options.apiKey;
    }

    return headers;
  }
}

/** Accumulates Anthropic streaming events into a single {@link ChatResult}. */
export class AnthropicStreamAccumulator {
  private text = '';
  private thinking = '';
  private readonly toolsByIndex = new Map<
    number,
    { id: string; name: string; json: string }
  >();
  private inputTokens = 0;
  private outputTokens = 0;
  private cachedTokens = 0;

  public constructor(
    private readonly onToken?: (token: string) => void,
    private readonly onThinkingToken?: (token: string) => void
  ) {}

  /** The model's streamed thinking, kept for debug logging alongside the result. */
  public get reasoning(): string {
    return this.thinking;
  }

  public handle(event: {
    type?: string;
    index?: number;
    content_block?: { type?: string; id?: string; name?: string };
    delta?: {
      type?: string;
      text?: string;
      partial_json?: string;
      thinking?: string;
    };
    message?: {
      usage?: {
        input_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
    };
    usage?: { output_tokens?: number };
  }): void {
    switch (event.type) {
      case AnthropicStreamEventType.MessageStart:
        // See the non-streaming path: `input_tokens` is only the uncached
        // portion, so add the cached prefix back in to get the full context size.
        this.cachedTokens = event.message?.usage?.cache_read_input_tokens ?? 0;
        this.inputTokens =
          (event.message?.usage?.input_tokens ?? 0) +
          this.cachedTokens +
          (event.message?.usage?.cache_creation_input_tokens ?? 0);
        break;
      case AnthropicStreamEventType.ContentBlockStart:
        if (event.content_block?.type === AnthropicBlockType.ToolUse) {
          this.toolsByIndex.set(event.index ?? 0, {
            id: event.content_block.id ?? '',
            name: event.content_block.name ?? '',
            json: '',
          });
        }
        break;
      case AnthropicStreamEventType.ContentBlockDelta: {
        const delta = event.delta;
        if (delta?.type === AnthropicDeltaType.TextDelta && delta.text) {
          this.text += delta.text;
          this.onToken?.(delta.text);
        } else if (
          delta?.type === AnthropicDeltaType.ThinkingDelta &&
          delta.thinking
        ) {
          this.thinking += delta.thinking;
          this.onThinkingToken?.(delta.thinking);
        } else if (delta?.type === AnthropicDeltaType.InputJsonDelta) {
          const tool = this.toolsByIndex.get(event.index ?? 0);
          if (tool) tool.json += delta.partial_json ?? '';
        }
        break;
      }
      case AnthropicStreamEventType.MessageDelta:
        if (event.usage?.output_tokens != null) {
          this.outputTokens = event.usage.output_tokens;
        }
        break;
      default:
        break;
    }
  }

  public toResult(): ChatResult {
    const toolCalls: ToolCall[] = [...this.toolsByIndex.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, tool]) => ({
        id: tool.id || `call_${index}`,
        name: tool.name,
        arguments: tool.json || '{}',
      }))
      .filter((call) => call.name);

    const content = this.text.trim() ? this.text : this.thinking;
    if (!content.trim() && toolCalls.length === 0) {
      throw new Error("Provider 'anthropic' returned an empty response.");
    }

    return {
      content,
      ...(this.inputTokens > 0
        ? {
            usage: {
              inputTokens: this.inputTokens,
              outputTokens: this.outputTokens,
              cachedTokens: this.cachedTokens,
            },
          }
        : {}),
      ...(toolCalls.length ? { toolCalls } : {}),
    };
  }
}
