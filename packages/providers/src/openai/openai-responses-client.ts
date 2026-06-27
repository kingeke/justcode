import { logRequestResponse } from '@core/application/debug-log';
import type {
  ChatRequest,
  ChatResult,
  TokenUsage,
} from '@core/ports/chat-model';
import type { ToolCall } from '@core/domain/message';
import { HttpError, joinUrl } from '@providers/http/http-client';
import {
  toResponsesPayload,
  toResponsesToolDefinitions,
  toToolCall,
} from '@providers/openai/openai-responses-wire';

export interface SendResponsesRequestOptions {
  /** Base URL of the provider; `/responses` is appended. */
  baseUrl: string;
  /** Fully-built request headers (auth, content-type, accept, etc.). */
  headers: Record<string, string>;
  request: ChatRequest;
  /** Provider id, used only for the empty-response error message. */
  providerId: string;
}

/**
 * Sends a chat turn through the OpenAI Responses API (`${baseUrl}/responses`)
 * and streams the result. Shared by the Codex-backed {@link
 * OpenAiResponsesProvider} and by {@link OpenAiCompatibleProvider} for Copilot
 * models that are only reachable via `/responses`. Callers supply the full
 * header set so provider-specific auth/integration headers stay out of here.
 */
export async function sendResponsesRequest({
  baseUrl,
  headers,
  request,
  providerId,
}: SendResponsesRequestOptions): Promise<ChatResult> {
  const { instructions, input } = toResponsesPayload(request.messages);
  const tools = toResponsesToolDefinitions(request.tools);

  const body = {
    model: request.model,
    ...(instructions ? { instructions } : {}),
    input,
    ...(tools
      ? { tools, tool_choice: 'auto', parallel_tool_calls: false }
      : {}),
    // gpt-5* are reasoning models; always send a reasoning block.
    reasoning: { effort: 'medium', summary: 'auto' },
    store: false,
    stream: true,
    include: [],
  };

  const url = joinUrl(baseUrl, '/responses');
  const requestLog = { url, method: 'POST', headers, body };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    ...(request.signal ? { signal: request.signal } : {}),
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

  const result = await consumeResponsesStream(
    response.body,
    request,
    providerId
  );
  await logRequestResponse({
    request: requestLog,
    response: { url, status: response.status, ok: true, body: result },
  });
  return result;
}

/** Reads the Responses SSE stream, dispatching text/reasoning/tool events. */
async function consumeResponsesStream(
  stream: ReadableStream<Uint8Array>,
  request: ChatRequest,
  providerId: string
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
    throw new Error(`Provider '${providerId}' returned an empty response.`);
  }

  return {
    content: finalContent,
    ...(usage ? { usage } : {}),
    ...(toolCalls.length ? { toolCalls } : {}),
  };
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
