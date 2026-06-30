import type {
  Tool,
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocationView,
  ToolResult,
} from '@core/ports/tool';
import { logRequestResponse } from '@core/application/debug-log';

interface WebSearchArguments {
  query: string;
  max_results?: number;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Default time a request may take before it is aborted. */
export const DEFAULT_WEB_SEARCH_TIMEOUT_MS = 30_000;
/** Default number of results returned when the caller doesn't ask for a count. */
export const DEFAULT_WEB_SEARCH_MAX_RESULTS = 5;
/** Hard ceiling on results, regardless of what the model asks for. */
export const MAX_WEB_SEARCH_MAX_RESULTS = 10;
/** Refuse to read response bodies larger than this to avoid huge payloads. */
const MAX_DOWNLOAD_BYTES = 5_000_000;
/**
 * DuckDuckGo's HTML results endpoint. It needs no API key and returns ordinary
 * search listings (title, link, snippet) we can parse — matching how WebFetchTool
 * stays keyless. A browser-like User-Agent is sent because the endpoint returns
 * an empty page to clients that don't look like a browser.
 */
const DUCKDUCKGO_HTML_ENDPOINT = 'https://html.duckduckgo.com/html/';
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Searches the web for a query and returns the top results as a list of titles,
 * URLs, and snippets. Results come from DuckDuckGo's keyless HTML endpoint, so no
 * credentials are required. The tool is read-only and does not require approval.
 * The request is bounded by a timeout and honors the context's `AbortSignal`
 * (e.g. when the user cancels). Pair it with `webfetch` to read a result's page.
 */
export class WebSearchTool implements Tool {
  public readonly requiresApproval = true;

  public readonly definition: ToolDefinition = {
    name: 'websearch',
    description:
      'Search the web and return the top results as a list of titles, URLs, ' +
      'and short snippets. Use this to find current information or to discover ' +
      'pages, then use the webfetch tool to read a specific result in full. ' +
      'Provide a "query" string and an optional "max_results" (default ' +
      `${DEFAULT_WEB_SEARCH_MAX_RESULTS}, max ${MAX_WEB_SEARCH_MAX_RESULTS}).`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query.',
        },
        max_results: {
          type: 'number',
          description:
            'Maximum number of results to return. Defaults to ' +
            `${DEFAULT_WEB_SEARCH_MAX_RESULTS} and is capped at ` +
            `${MAX_WEB_SEARCH_MAX_RESULTS}.`,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  };

  public describe(rawArguments: string): ToolInvocationView {
    const parsed = tryParse(rawArguments);
    if (!parsed) {
      return { title: 'websearch (unparseable arguments)' };
    }
    return {
      title: `websearch: ${truncate(parsed.query, 80)}`,
      preview: parsed.query,
    };
  }

  public async execute(
    rawArguments: string,
    context?: ToolExecutionContext
  ): Promise<ToolResult> {
    const parsed = tryParse(rawArguments);
    if (!parsed) {
      return {
        content: 'Invalid arguments: expected JSON with a "query" string.',
        isError: true,
      };
    }

    const query = parsed.query.trim();
    if (query.length === 0) {
      return {
        content: 'Invalid arguments: "query" must be a non-empty string.',
        isError: true,
      };
    }

    const maxResults = clampMaxResults(
      parsed.max_results ?? DEFAULT_WEB_SEARCH_MAX_RESULTS
    );

    return this.run(query, maxResults, context);
  }

  private async run(
    query: string,
    maxResults: number,
    context?: ToolExecutionContext
  ): Promise<ToolResult> {
    // A dedicated controller enforces the timeout while still aborting if the
    // caller's signal fires.
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error('timeout')),
      DEFAULT_WEB_SEARCH_TIMEOUT_MS
    );
    const onAbort = (): void => controller.abort();
    context?.signal?.addEventListener('abort', onAbort, { once: true });
    if (context?.signal?.aborted) {
      controller.abort();
    }

    const endpoint = `${DUCKDUCKGO_HTML_ENDPOINT}?q=${encodeURIComponent(query)}`;

    try {
      const response = await fetch(endpoint, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          accept: 'text/html',
          'user-agent': BROWSER_USER_AGENT,
        },
      });

      if (!response.ok) {
        await logRequestResponse({
          request: {
            url: endpoint,
            method: 'GET',
            headers: { accept: 'text/html', 'user-agent': BROWSER_USER_AGENT },
            body: '',
          },
          response: {
            url: endpoint,
            status: response.status,
            ok: response.ok,
            body: `${response.status} ${response.statusText}`,
          },
        });
        return {
          content: `Search failed: ${response.status} ${response.statusText}`,
          isError: true,
        };
      }

      const body = await readBoundedBody(response);
      if (body === undefined) {
        return {
          content: `Search response exceeded ${MAX_DOWNLOAD_BYTES} bytes and was not read.`,
          isError: true,
        };
      }

      const results = parseResults(body).slice(0, maxResults);
      if (results.length === 0) {
        return { content: `No results found for "${query}".` };
      }

      const result = { content: formatResults(query, results) };
      await logRequestResponse({
        request: {
          url: endpoint,
          method: 'GET',
          headers: { accept: 'text/html', 'user-agent': BROWSER_USER_AGENT },
          body: '',
        },
        response: {
          url: endpoint,
          status: response.status,
          ok: response.ok,
          body: result,
        },
      });
      return result;
    } catch (error: unknown) {
      if (context?.signal?.aborted) {
        return { content: `Search was cancelled: "${query}"`, isError: true };
      }
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'timeout' || controller.signal.aborted) {
        return {
          content: `Search timed out after ${DEFAULT_WEB_SEARCH_TIMEOUT_MS}ms: "${query}"`,
          isError: true,
        };
      }
      const result = {
        content: `Failed to search for "${query}": ${message}`,
        isError: true,
      };
      await logRequestResponse({
        request: {
          url: endpoint,
          method: 'GET',
          headers: { accept: 'text/html', 'user-agent': BROWSER_USER_AGENT },
          body: '',
        },
        response: { url: endpoint, status: 0, ok: false, body: result },
      });
      return result;
    } finally {
      clearTimeout(timer);
      context?.signal?.removeEventListener('abort', onAbort);
    }
  }
}

function tryParse(rawArguments: string): WebSearchArguments | undefined {
  try {
    const parsed = JSON.parse(rawArguments) as Partial<WebSearchArguments>;
    if (typeof parsed.query !== 'string') {
      return undefined;
    }
    if (
      typeof parsed.max_results === 'number' &&
      Number.isFinite(parsed.max_results)
    ) {
      return { query: parsed.query, max_results: parsed.max_results };
    }
    return { query: parsed.query };
  } catch {
    return undefined;
  }
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

/**
 * Pull search results out of DuckDuckGo's HTML. Each result links via a
 * `result__a` anchor (title + redirect URL) and carries a `result__snippet`
 * block; we walk the anchors in order and attach the snippet that follows each.
 */
function parseResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const anchorPattern =
    /<a\b[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html)) !== null) {
    const url = resolveResultUrl(match[1] ?? '');
    const title = cleanText(match[2] ?? '');
    if (!url || !title) continue;

    const snippet = extractSnippetAfter(html, anchorPattern.lastIndex);
    results.push({ title, url, snippet });
  }

  return results;
}

/**
 * The first `result__snippet` block at or after `fromIndex` belongs to the most
 * recently seen result anchor. Searching forward from the anchor keeps title and
 * snippet paired without assuming a fixed surrounding structure.
 */
function extractSnippetAfter(html: string, fromIndex: number): string {
  const snippetPattern =
    /class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/i;
  const rest = html.slice(fromIndex);
  const match = snippetPattern.exec(rest);
  return match ? cleanText(match[1] ?? '') : '';
}

/**
 * DuckDuckGo wraps result links in a redirect (`//duckduckgo.com/l/?uddg=…`);
 * the real destination is the `uddg` query parameter. Fall back to the raw href
 * when it isn't a redirect.
 */
function resolveResultUrl(href: string): string {
  try {
    const url = new URL(href, 'https://duckduckgo.com');
    const target = url.searchParams.get('uddg');
    return target ?? url.href;
  } catch {
    return '';
  }
}

function formatResults(query: string, results: SearchResult[]): string {
  const blocks = results.map((result, index) => {
    const lines = [`${index + 1}. ${result.title}`, `   ${result.url}`];
    if (result.snippet) lines.push(`   ${result.snippet}`);
    return lines.join('\n');
  });
  return `Search results for "${query}":\n\n${blocks.join('\n\n')}`;
}

/** Strip HTML tags, decode common entities, and collapse whitespace. */
function cleanText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
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
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return named[entity.toLowerCase()] ?? whole;
  });
}

function clampMaxResults(value: number): number {
  return Math.max(1, Math.min(MAX_WEB_SEARCH_MAX_RESULTS, Math.floor(value)));
}

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}
