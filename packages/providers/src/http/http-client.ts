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

export async function requestSseStream(
  url: string,
  options: JsonRequestOptions,
  onToken: (token: string) => void
): Promise<void> {
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
      if (data === '[DONE]') return;

      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          onToken(content);
        }
      } catch {
        // skip malformed SSE lines
      }
    }
  }
}

export async function requestNdjsonStream(
  url: string,
  options: JsonRequestOptions,
  onToken: (token: string) => void
): Promise<void> {
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
        };
        const content = parsed.message?.content;
        if (content) {
          onToken(content);
        }
        if (parsed.done) return;
      } catch {
        // skip malformed NDJSON lines
      }
    }
  }
}
