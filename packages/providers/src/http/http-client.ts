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

export interface JsonRequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
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
    signal: AbortSignal.timeout(30_000),
  };

  if (options.body !== undefined) {
    requestOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, requestOptions);

  if (!response.ok) {
    const responseText = await response.text();
    throw new HttpError(
      `Request to ${url} failed with status ${response.status}.`,
      response.status,
      responseText
    );
  }

  return response.json() as Promise<T>;
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

export interface SseUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export async function requestSseStream(
  url: string,
  options: JsonRequestOptions,
  onToken: (token: string) => void
): Promise<SseUsage> {
  const requestOptions: RequestInit = {
    method: options.method ?? 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...options.headers,
    },
    signal: AbortSignal.timeout(120_000),
  };

  if (options.body !== undefined) {
    requestOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, requestOptions);

  if (!response.ok) {
    const responseText = await response.text();
    throw new HttpError(
      `Request to ${url} failed with status ${response.status}.`,
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
      if (data === '[DONE]') return usage;

      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            prompt_tokens_details?: { cached_tokens?: number };
          };
        };
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          onToken(content);
        }
        if (parsed.usage) {
          usage.inputTokens = parsed.usage.prompt_tokens ?? 0;
          usage.outputTokens = parsed.usage.completion_tokens ?? 0;
          usage.cachedTokens =
            parsed.usage.prompt_tokens_details?.cached_tokens ?? 0;
        }
      } catch {
        // skip malformed SSE lines
      }
    }
  }

  return usage;
}

export async function requestNdjsonStream(
  url: string,
  options: JsonRequestOptions,
  onToken: (token: string) => void
): Promise<SseUsage> {
  const requestOptions: RequestInit = {
    method: options.method ?? 'POST',
    headers: {
      'content-type': 'application/json',
      ...options.headers,
    },
    signal: AbortSignal.timeout(120_000),
  };

  if (options.body !== undefined) {
    requestOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, requestOptions);

  if (!response.ok) {
    const responseText = await response.text();
    throw new HttpError(
      `Request to ${url} failed with status ${response.status}.`,
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
          message?: { content?: string };
          done?: boolean;
          prompt_eval_count?: number;
          eval_count?: number;
        };
        const content = parsed.message?.content;
        if (content) {
          onToken(content);
        }
        if (parsed.done) {
          usage.inputTokens = parsed.prompt_eval_count ?? 0;
          usage.outputTokens = parsed.eval_count ?? 0;
          return usage;
        }
      } catch {
        // skip malformed NDJSON lines
      }
    }
  }

  return usage;
}
