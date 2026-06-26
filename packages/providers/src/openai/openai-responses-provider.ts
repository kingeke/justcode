import { randomUUID } from 'node:crypto';

import { logRequestResponse } from '@core/application/debug-log';
import {
  type ChatRequest,
  type ChatResult,
  type ModelInfo,
  type ProviderClient,
  type TokenUsage,
} from '@core/ports/chat-model';
import { ProviderId } from '@core/ports/provider-catalog';
import type { ToolCall } from '@core/domain/message';
import { HttpError, joinUrl } from '@providers/http/http-client';
import {
  toResponsesPayload,
  toResponsesToolDefinitions,
  toToolCall,
} from '@providers/openai/openai-responses-wire';

interface OpenAiResponsesProviderOptions {
  baseUrl: string;
  /** ChatGPT account id, sent as the `chatgpt-account-id` header. */
  chatgptAccountId?: string | undefined;
  /** Resolves a fresh OAuth access token per request (refreshing on expiry). */
  getAccessToken: () => Promise<string>;
  defaultModel?: string | undefined;
}

/**
 * Models reachable through a ChatGPT subscription via the Codex backend. There
 * is no `/models` listing endpoint for ChatGPT-account tokens (it 403s with
 * `Missing scopes: api.model.read`), so the set is fixed here, mirroring what
 * Codex exposes.
 */
const CODEX_MODELS: ReadonlyArray<{ id: string; displayName: string }> = [
  { id: 'gpt-5.5', displayName: 'GPT-5.5' },
  { id: 'gpt-5.5-fast', displayName: 'GPT-5.5 Fast' },
  { id: 'gpt-5.5-pro', displayName: 'GPT-5.5 Pro' },
  { id: 'gpt-5.4', displayName: 'GPT-5.4' },
  { id: 'gpt-5.4-fast', displayName: 'GPT-5.4 Fast' },
  { id: 'gpt-5.4-mini', displayName: 'GPT-5.4 mini' },
  { id: 'gpt-5.4-mini-fast', displayName: 'GPT-5.4 mini Fast' },
  { id: 'gpt-5.3-codex-spark', displayName: 'GPT-5.3 Codex Spark' },
];

const DEFAULT_CODEX_MODEL = 'gpt-5.5';

/**
 * OpenAI provider backed by the Codex Responses API (ChatGPT subscription
 * sign-in). Unlike {@link OpenAiCompatibleProvider} this speaks the Responses
 * wire format against `${baseUrl}/responses`, attaches the `chatgpt-account-id`
 * header, and lists a fixed model set instead of calling `/models`.
 */
export class OpenAiResponsesProvider implements ProviderClient {
  public readonly providerId = ProviderId.Openai;

  public constructor(
    private readonly options: OpenAiResponsesProviderOptions
  ) {}

  public async listModels(): Promise<ModelInfo[]> {
    return CODEX_MODELS.map((model) => ({
      id: model.id,
      displayName: model.displayName,
      providerId: this.providerId,
    }));
  }

  public getDefaultModel(): string | undefined {
    return this.options.defaultModel ?? DEFAULT_CODEX_MODEL;
  }

  public async sendChat(request: ChatRequest): Promise<ChatResult> {
    const { instructions, input } = toResponsesPayload(request.messages);
    const tools = toResponsesToolDefinitions(request.tools);

    const body = {
      model: request.model,
      ...(instructions ? { instructions } : {}),
      input,
      ...(tools
        ? { tools, tool_choice: 'auto', parallel_tool_calls: false }
        : {}),
      // gpt-5* are reasoning models; Codex always sends a reasoning block.
      reasoning: { effort: 'medium', summary: 'auto' },
      store: false,
      stream: true,
      include: [],
    };

    const url = joinUrl(this.options.baseUrl, '/responses');
    const headers = await this.createHeaders();
    const requestLog = { url, method: 'POST', headers, body };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: request.signal
        ? AbortSignal.any([request.signal, AbortSignal.timeout(300_000)])
        : AbortSignal.timeout(300_000),
    });

    if (!response.ok || !response.body) {
      const text = await response.text();
      await logRequestResponse({
        request: requestLog,
        response: { url, status: response.status, ok: response.ok, body: text },
      });
      throw new HttpError(
        `Request to ${url} failed with status ${response.status}. ${text}`,
        response.status,
        text
      );
    }

    const result = await this.consumeStream(response.body, request);
    await logRequestResponse({
      request: requestLog,
      response: { url, status: response.status, ok: true, body: result },
    });
    return result;
  }

  /** Reads the Responses SSE stream, dispatching text/reasoning/tool events. */
  private async consumeStream(
    stream: ReadableStream<Uint8Array>,
    request: ChatRequest
  ): Promise<ChatResult> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let reasoning = '';
    const toolCalls: ToolCall[] = [];
    let usage: TokenUsage | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;

        let event: ResponsesStreamEvent;
        try {
          event = JSON.parse(data) as ResponsesStreamEvent;
        } catch {
          continue;
        }

        switch (event.type) {
          case 'response.output_text.delta':
            if (event.delta) {
              content += event.delta;
              request.onToken?.(event.delta);
            }
            break;
          case 'response.reasoning_summary_text.delta':
          case 'response.reasoning_text.delta':
            if (event.delta) {
              reasoning += event.delta;
              request.onThinkingToken?.(event.delta);
            }
            break;
          case 'response.output_item.done':
            if (event.item?.type === 'function_call') {
              const call = toToolCall(event.item);
              if (call) toolCalls.push(call);
            }
            break;
          case 'response.completed':
            usage = mapUsage(event.response?.usage);
            break;
          case 'response.failed':
          case 'error':
            throw new Error(
              event.response?.error?.message ??
                event.error?.message ??
                'OpenAI Responses stream failed.'
            );
        }
      }
    }

    const finalContent = content.trim() ? content : reasoning;
    if (!finalContent.trim() && toolCalls.length === 0) {
      throw new Error("Provider 'openai' returned an empty response.");
    }

    return {
      content: finalContent,
      ...(usage ? { usage } : {}),
      ...(toolCalls.length ? { toolCalls } : {}),
    };
  }

  private async createHeaders(): Promise<Record<string, string>> {
    return {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      authorization: `Bearer ${await this.options.getAccessToken()}`,
      ...(this.options.chatgptAccountId
        ? { 'chatgpt-account-id': this.options.chatgptAccountId }
        : {}),
      // Codex backend identifies the calling client and threads a session id.
      'openai-beta': 'responses=experimental',
      originator: 'codex_cli_rs',
      session_id: randomUUID(),
    };
  }
}

interface ResponsesStreamEvent {
  type: string;
  delta?: string;
  item?: {
    type?: string;
    call_id?: string;
    id?: string;
    name?: string;
    arguments?: string;
  };
  response?: {
    error?: { message?: string };
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      input_tokens_details?: { cached_tokens?: number };
    };
  };
  error?: { message?: string };
}

function mapUsage(
  usage: NonNullable<ResponsesStreamEvent['response']>['usage']
): TokenUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0,
  };
}
