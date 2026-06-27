import type { ToolCall } from '@core/domain/message';
import { logRequestResponse } from '@core/application/debug-log';

export class HttpError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly responseText: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Builds an error message that includes the server's response body so failures
 * surface the actual reason (e.g. the provider's `{ "error": ... }`) instead of
 * just the HTTP status.
 */
function httpErrorMessage(
  url: string,
  status: number,
  responseText: string
): string {
  const base = `Request to ${url} failed with status ${status}.`;
  const detail = extractErrorDetail(responseText);
  return detail ? `${base} ${detail}` : base;
}

function extractErrorDetail(responseText: string): string | undefined {
  const trimmed = responseText.trim();
  if (!trimmed) return undefined;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object') {
      const error = (parsed as { error?: unknown }).error;
      if (typeof error === 'string') return error;
      if (error && typeof error === 'object') {
        const message = (error as { message?: unknown }).message;
        if (typeof message === 'string') return message;
      }
      const message = (parsed as { message?: unknown }).message;
      if (typeof message === 'string') return message;
    }
  } catch {
    // Not JSON; fall through to the raw body.
  }

  return trimmed;
}

export interface JsonRequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
}

export async function requestJson<T>(
  url: string,
  options: JsonRequestOptions = {}
): Promise<T> {
  const requestOptions: RequestInit = {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...options.headers,
    },
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
  };

  if (options.body !== undefined) {
    requestOptions.body = JSON.stringify(options.body);
  }

  const request = {
    url,
    method: String(requestOptions.method),
    headers: requestOptions.headers as Record<string, string>,
    body: options.body,
  };

  const response = await fetch(url, requestOptions);

  if (!response.ok) {
    const responseText = await response.text();
    await logRequestResponse({
      request,
      response: {
        url,
        status: response.status,
        ok: response.ok,
        body: responseText,
      },
    });
    throw new HttpError(
      httpErrorMessage(url, response.status, responseText),
      response.status,
      responseText
    );
  }

  const parsed = (await response.json()) as T;
  await logRequestResponse({
    request,
    response: {
      url,
      status: response.status,
      ok: response.ok,
      body: parsed,
    },
  });
  return parsed;
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

export interface SseUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cost?: number;
}

export interface StreamResult {
  usage: SseUsage;
  toolCalls: ToolCall[];
}

/** Accumulates streamed OpenAI `tool_calls` deltas keyed by their `index`. */
class ToolCallAccumulator {
  private readonly byIndex = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();

  public addDelta(
    deltas:
      | Array<{
          index?: number;
          id?: string;
          function?: { name?: string; arguments?: string };
        }>
      | undefined
  ): void {
    if (!deltas) return;
    for (const delta of deltas) {
      const index = delta.index ?? 0;
      const current = this.byIndex.get(index) ?? {
        id: '',
        name: '',
        arguments: '',
      };
      if (delta.id) current.id = delta.id;
      if (delta.function?.name) current.name = delta.function.name;
      if (delta.function?.arguments) {
        current.arguments += delta.function.arguments;
      }
      this.byIndex.set(index, current);
    }
  }

  public toToolCalls(): ToolCall[] {
    return [...this.byIndex.entries()]
      .sort(([left], [right]) => left - right)
      .map(([index, call]) => ({
        id: call.id || `call_${index}`,
        name: call.name,
        arguments: call.arguments,
      }))
      .filter((call) => call.name);
  }
}

export async function requestSseStream(
  url: string,
  options: JsonRequestOptions,
  onToken: (token: string) => void,
  onThinkingToken?: (token: string) => void
): Promise<StreamResult> {
  const requestOptions: RequestInit = {
    method: options.method ?? 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...options.headers,
    },
    ...(options.signal ? { signal: options.signal } : {}),
  };

  if (options.body !== undefined) {
    requestOptions.body = JSON.stringify(options.body);
  }

  const request = {
    url,
    method: String(requestOptions.method),
    headers: requestOptions.headers as Record<string, string>,
    body: options.body,
  };

  const response = await fetch(url, requestOptions);

  if (!response.ok) {
    const responseText = await response.text();
    await logRequestResponse({
      request,
      response: {
        url,
        status: response.status,
        ok: response.ok,
        body: responseText,
      },
    });
    throw new HttpError(
      httpErrorMessage(url, response.status, responseText),
      response.status,
      responseText
    );
  }

  if (!response.body) {
    throw new Error('Response body is null.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const usage: SseUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
  const toolCalls = new ToolCallAccumulator();
  // Accumulated only so the debug log captures the full streamed reply; the
  // tokens themselves are delivered live via onToken/onThinkingToken.
  let content = '';
  let reasoning = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') {
        const result = { usage, toolCalls: toolCalls.toToolCalls() };
        await logRequestResponse({
          request,
          response: {
            url,
            status: response.status,
            ok: true,
            body: { ...result, content, ...(reasoning ? { reasoning } : {}) },
          },
        });
        return result;
      }

      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{
            delta?: {
              content?: string;
              reasoning?: string;
              reasoning_content?: string;
              tool_calls?: Array<{
                index?: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
          }>;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            prompt_tokens_details?: { cached_tokens?: number };
            cost?: number;
          };
        };
        const delta = parsed.choices?.[0]?.delta;
        const deltaContent = delta?.content;
        const thinking = delta?.reasoning ?? delta?.reasoning_content;
        if (deltaContent) {
          content += deltaContent;
          onToken(deltaContent);
        }
        if (thinking) {
          reasoning += thinking;
          if (onThinkingToken) onThinkingToken(thinking);
        }
        toolCalls.addDelta(delta?.tool_calls);
        if (parsed.usage) {
          usage.inputTokens = parsed.usage.prompt_tokens ?? 0;
          usage.outputTokens = parsed.usage.completion_tokens ?? 0;
          usage.cachedTokens =
            parsed.usage.prompt_tokens_details?.cached_tokens ?? 0;
          if (parsed.usage.cost != null) {
            usage.cost = parsed.usage.cost;
          }
        }
      } catch {
        // skip malformed SSE lines
      }
    }
  }

  const result = { usage, toolCalls: toolCalls.toToolCalls() };
  await logRequestResponse({
    request,
    response: {
      url,
      status: response.status,
      ok: true,
      body: { ...result, content, ...(reasoning ? { reasoning } : {}) },
    },
  });
  return result;
}

export async function requestNdjsonStream(
  url: string,
  options: JsonRequestOptions,
  onToken: (token: string) => void,
  onThinkingToken?: (token: string) => void
): Promise<StreamResult> {
  const requestOptions: RequestInit = {
    method: options.method ?? 'POST',
    headers: {
      'content-type': 'application/json',
      ...options.headers,
    },
    ...(options.signal ? { signal: options.signal } : {}),
  };

  if (options.body !== undefined) {
    requestOptions.body = JSON.stringify(options.body);
  }

  const request = {
    url,
    method: String(requestOptions.method),
    headers: requestOptions.headers as Record<string, string>,
    body: options.body,
  };

  const response = await fetch(url, requestOptions);

  if (!response.ok) {
    const responseText = await response.text();
    await logRequestResponse({
      request,
      response: {
        url,
        status: response.status,
        ok: response.ok,
        body: responseText,
      },
    });
    throw new HttpError(
      httpErrorMessage(url, response.status, responseText),
      response.status,
      responseText
    );
  }

  if (!response.body) {
    throw new Error('Response body is null.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const usage: SseUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
  // Ollama emits each tool call complete within a single message chunk (no
  // cross-chunk deltas), so we collect them as they arrive.
  const toolCalls: ToolCall[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed) as {
          message?: {
            content?: string;
            thinking?: string;
            tool_calls?: Array<{
              function?: { name?: string; arguments?: unknown };
            }>;
          };
          done?: boolean;
          prompt_eval_count?: number;
          eval_count?: number;
        };
        const content = parsed.message?.content;
        const thinking = parsed.message?.thinking;
        if (content) {
          onToken(content);
        }
        if (thinking && onThinkingToken) {
          onThinkingToken(thinking);
        }
        for (const call of parsed.message?.tool_calls ?? []) {
          const args = call.function?.arguments;
          toolCalls.push({
            id: `call_${toolCalls.length}`,
            name: call.function?.name ?? '',
            arguments:
              typeof args === 'string' ? args : JSON.stringify(args ?? {}),
          });
        }
        if (parsed.done) {
          usage.inputTokens = parsed.prompt_eval_count ?? 0;
          usage.outputTokens = parsed.eval_count ?? 0;
          const result = {
            usage,
            toolCalls: toolCalls.filter((call) => call.name),
          };
          await logRequestResponse({
            request,
            response: { url, status: response.status, ok: true, body: result },
          });
          return result;
        }
      } catch {
        // skip malformed NDJSON lines
      }
    }
  }

  const result = { usage, toolCalls: toolCalls.filter((call) => call.name) };
  await logRequestResponse({
    request,
    response: { url, status: response.status, ok: true, body: result },
  });
  return result;
}
