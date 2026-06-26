import type {
  Tool,
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocationView,
  ToolResult,
} from '@core/ports/tool';

interface WebFetchArguments {
  url: string;
  max_length?: number;
}

/** Default time a request may take before it is aborted. */
export const DEFAULT_WEB_FETCH_TIMEOUT_MS = 30_000;
/** Default cap on returned characters; large pages are truncated to this. */
export const DEFAULT_WEB_FETCH_MAX_LENGTH = 20_000;
/** Hard ceiling on the returned characters, regardless of what the model asks. */
export const MAX_WEB_FETCH_MAX_LENGTH = 100_000;
/** Refuse to download bodies larger than this to avoid pulling huge payloads. */
const MAX_DOWNLOAD_BYTES = 5_000_000;

/**
 * Fetches a single URL over HTTP(S) and returns its content as readable text.
 * HTML responses are stripped of scripts, styles, and markup so the model sees
 * the page's text rather than raw tags; other text responses are returned as
 * received. The tool is read-only (it only performs GET requests) and so does
 * not require approval. The request is bounded by a timeout and honors the
 * context's `AbortSignal` (e.g. when the user cancels).
 */
export class WebFetchTool implements Tool {
  public readonly requiresApproval = false;

  public readonly definition: ToolDefinition = {
    name: 'webfetch',
    description:
      'Fetch the contents of a single HTTP or HTTPS URL and return it as ' +
      'readable text. HTML pages are stripped of scripts, styles, and markup ' +
      'so you get the page text rather than raw tags; other text responses are ' +
      'returned as-is. Only GET requests are made. Provide an optional ' +
      `"max_length" (default ${DEFAULT_WEB_FETCH_MAX_LENGTH}, max ` +
      `${MAX_WEB_FETCH_MAX_LENGTH}) to cap how many characters are returned; ` +
      'longer content is truncated.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The absolute http:// or https:// URL to fetch.',
        },
        max_length: {
          type: 'number',
          description:
            'Maximum number of characters of text to return. Defaults to ' +
            `${DEFAULT_WEB_FETCH_MAX_LENGTH} and is capped at ` +
            `${MAX_WEB_FETCH_MAX_LENGTH}.`,
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
  };

  public describe(rawArguments: string): ToolInvocationView {
    const parsed = tryParse(rawArguments);
    if (!parsed) {
      return { title: 'webfetch (unparseable arguments)' };
    }
    return {
      title: `webfetch: ${truncate(parsed.url, 80)}`,
      preview: parsed.url,
    };
  }

  public async execute(
    rawArguments: string,
    context?: ToolExecutionContext
  ): Promise<ToolResult> {
    const parsed = tryParse(rawArguments);
    if (!parsed) {
      return {
        content: 'Invalid arguments: expected JSON with a "url" string.',
        isError: true,
      };
    }

    const url = parseUrl(parsed.url);
    if (!url) {
      return {
        content:
          'Invalid arguments: "url" must be an absolute http:// or https:// URL.',
        isError: true,
      };
    }

    const maxLength = clampMaxLength(
      parsed.max_length ?? DEFAULT_WEB_FETCH_MAX_LENGTH
    );

    return this.run(url, maxLength, context);
  }

  private async run(
    url: URL,
    maxLength: number,
    context?: ToolExecutionContext
  ): Promise<ToolResult> {
    // A dedicated controller enforces the timeout while still aborting if the
    // caller's signal fires.
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error('timeout')),
      DEFAULT_WEB_FETCH_TIMEOUT_MS
    );
    const onAbort = (): void => controller.abort();
    context?.signal?.addEventListener('abort', onAbort, { once: true });
    if (context?.signal?.aborted) {
      controller.abort();
    }

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { accept: 'text/html,text/plain,*/*' },
      });

      if (!response.ok) {
        return {
          content: `Request failed: ${response.status} ${response.statusText} for ${url.href}`,
          isError: true,
        };
      }

      const body = await readBoundedBody(response);
      if (body === undefined) {
        return {
          content: `Response body exceeded ${MAX_DOWNLOAD_BYTES} bytes and was not fetched: ${url.href}`,
          isError: true,
        };
      }

      const contentType = response.headers.get('content-type') ?? '';
      const text = isHtml(contentType, body) ? htmlToText(body) : body.trim();

      if (text.length === 0) {
        return {
          content: `Fetched ${url.href} but it contained no readable text.`,
        };
      }

      const truncated = text.length > maxLength;
      const note = truncated
        ? `\n\n(content truncated at ${maxLength} characters)`
        : '';
      return {
        content: `Fetched ${url.href}:\n\n${text.slice(0, maxLength)}${note}`,
      };
    } catch (error: unknown) {
      if (context?.signal?.aborted) {
        return { content: `Fetch was cancelled: ${url.href}`, isError: true };
      }
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'timeout' || controller.signal.aborted) {
        return {
          content: `Request timed out after ${DEFAULT_WEB_FETCH_TIMEOUT_MS}ms: ${url.href}`,
          isError: true,
        };
      }
      return {
        content: `Failed to fetch ${url.href}: ${message}`,
        isError: true,
      };
    } finally {
      clearTimeout(timer);
      context?.signal?.removeEventListener('abort', onAbort);
    }
  }
}

function tryParse(rawArguments: string): WebFetchArguments | undefined {
  try {
    const parsed = JSON.parse(rawArguments) as Partial<WebFetchArguments>;
    if (typeof parsed.url !== 'string') {
      return undefined;
    }
    if (
      typeof parsed.max_length === 'number' &&
      Number.isFinite(parsed.max_length)
    ) {
      return { url: parsed.url, max_length: parsed.max_length };
    }
    return { url: parsed.url };
  } catch {
    return undefined;
  }
}

function parseUrl(value: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  return url.protocol === 'http:' || url.protocol === 'https:'
    ? url
    : undefined;
}

/** Read the response body but bail out if it grows beyond the byte cap. */
async function readBoundedBody(
  response: Response
): Promise<string | undefined> {
  const lengthHeader = response.headers.get('content-length');
  if (lengthHeader && Number(lengthHeader) > MAX_DOWNLOAD_BYTES) {
    return undefined;
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
    return undefined;
  }
  return new TextDecoder('utf-8').decode(buffer);
}

function isHtml(contentType: string, body: string): boolean {
  if (/\b(text\/html|application\/xhtml\+xml)\b/i.test(contentType)) {
    return true;
  }
  // Fall back to sniffing when the server sends no useful content type.
  return (
    contentType.trim().length === 0 && /<html[\s>]|<!doctype html/i.test(body)
  );
}

/**
 * Strip HTML down to readable text: drop script/style/head content, turn block
 * boundaries into newlines, remove the remaining tags, and decode the handful
 * of entities that appear in plain prose.
 */
function htmlToText(html: string): string {
  const withoutHidden = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|head|template)[\s\S]*?<\/\1>/gi, ' ');

  const withBreaks = withoutHidden
    .replace(
      /<\/(p|div|section|article|header|footer|li|tr|h[1-6]|blockquote)>/gi,
      '\n'
    )
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ');

  const stripped = withBreaks.replace(/<[^>]+>/g, ' ');

  return decodeEntities(stripped)
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    mdash: '—',
    ndash: '–',
    hellip: '…',
    copy: '©',
    reg: '®',
    trade: '™',
  };
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function clampMaxLength(value: number): number {
  return Math.max(1, Math.min(MAX_WEB_FETCH_MAX_LENGTH, Math.floor(value)));
}

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}
