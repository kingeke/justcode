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
