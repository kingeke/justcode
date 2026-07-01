import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import type {
  Tool,
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocationView,
  ToolResult,
} from '@core/ports/tool';
import { logRequestResponse } from '@core/application/debug-log';

interface WebFetchArguments {
  url: string;
  max_length?: number;
}

/**
 * Resolves a hostname to its IP addresses. Injectable so the SSRF guard can be
 * tested without real DNS; defaults to the system resolver.
 */
export type HostResolver = (hostname: string) => Promise<string[]>;

const defaultHostResolver: HostResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true });
  return records.map((record) => record.address);
};

/** How many redirect hops to follow before giving up. */
const MAX_REDIRECTS = 5;

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
  public readonly requiresApproval = true;

  public constructor(
    private readonly resolveHost: HostResolver = defaultHostResolver
  ) {}

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
      // Follow redirects manually so every hop's host is re-validated against
      // the SSRF block-list — otherwise an allowed public URL could 302 into an
      // internal target (cloud metadata, localhost, RFC-1918).
      const requestHeaders = { accept: 'text/html,text/plain,*/*' };
      let currentUrl = url;
      let response: Response | undefined;

      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        const blockedReason = await this.checkSsrf(currentUrl);
        if (blockedReason) {
          return {
            content: `Refusing to fetch ${currentUrl.href}: ${blockedReason}`,
            isError: true,
          };
        }

        response = await fetch(currentUrl, {
          signal: controller.signal,
          redirect: 'manual',
          headers: requestHeaders,
        });

        if (!isRedirect(response.status)) {
          break;
        }

        const location = response.headers.get('location');
        if (!location) {
          break;
        }
        const nextUrl = parseUrl(new URL(location, currentUrl).href);
        if (!nextUrl) {
          return {
            content: `Refusing to follow redirect to a non-http(s) URL from ${currentUrl.href}`,
            isError: true,
          };
        }
        currentUrl = nextUrl;
        if (hop === MAX_REDIRECTS) {
          return {
            content: `Too many redirects (>${MAX_REDIRECTS}) starting from ${url.href}`,
            isError: true,
          };
        }
      }

      if (!response) {
        return {
          content: `Request failed: no response for ${url.href}`,
          isError: true,
        };
      }

      if (!response.ok) {
        await logRequestResponse({
          request: {
            url: url.href,
            method: 'GET',
            headers: { accept: 'text/html,text/plain,*/*' },
            body: '',
          },
          response: {
            url: url.href,
            status: response.status,
            ok: response.ok,
            body: `${response.status} ${response.statusText}`,
          },
        });
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
      const result = {
        content: `Fetched ${url.href}:\n\n${text.slice(0, maxLength)}${note}`,
      };
      await logRequestResponse({
        request: {
          url: url.href,
          method: 'GET',
          headers: { accept: 'text/html,text/plain,*/*' },
          body: '',
        },
        response: {
          url: url.href,
          status: response.status,
          ok: response.ok,
          body: result,
        },
      });
      return result;
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
      const result = {
        content: `Failed to fetch ${url.href}: ${message}`,
        isError: true,
      };
      await logRequestResponse({
        request: {
          url: url.href,
          method: 'GET',
          headers: { accept: 'text/html,text/plain,*/*' },
          body: '',
        },
        response: { url: url.href, status: 0, ok: false, body: result },
      });
      return result;
    } finally {
      clearTimeout(timer);
      context?.signal?.removeEventListener('abort', onAbort);
    }
  }

  /**
   * Returns a reason string if {@link target} must not be fetched (loopback,
   * link-local/metadata, private, or otherwise reserved address), or undefined
   * when it is a safe public destination. Hostnames are resolved through
   * {@link resolveHost} so a public name that maps to an internal IP (DNS
   * rebinding) is still caught.
   */
  private async checkSsrf(target: URL): Promise<string | undefined> {
    const host = target.hostname.replace(/^\[|\]$/g, '').toLowerCase();

    if (isBlockedHostname(host)) {
      return 'host resolves to a loopback or internal address';
    }
    if (isIP(host)) {
      return isBlockedAddress(host)
        ? 'host is a private, loopback, or reserved IP address'
        : undefined;
    }

    let addresses: string[];
    try {
      addresses = await this.resolveHost(host);
    } catch {
      return `could not resolve host '${host}'`;
    }
    if (addresses.length === 0) {
      return `could not resolve host '${host}'`;
    }
    if (addresses.some(isBlockedAddress)) {
      return 'host resolves to a private, loopback, or reserved IP address';
    }
    return undefined;
  }
}

/** 3xx statuses that carry a `Location` we would otherwise follow. */
function isRedirect(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

/** Hostnames that always denote the local machine or a private network. */
function isBlockedHostname(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa') ||
    host === '0.0.0.0'
  );
}

/**
 * True when an IP literal falls in a loopback, link-local (incl. the
 * 169.254.169.254 cloud-metadata address), private, or otherwise reserved
 * range that a fetch tool should never reach.
 */
function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    return isBlockedIpv4(address);
  }
  if (version === 6) {
    return isBlockedIpv6(address);
  }
  // Not a parseable IP — treat as unsafe rather than guess.
  return true;
}

function isBlockedIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o))) {
    return true;
  }
  const [a = -1, b = -1] = octets;
  return (
    a === 0 || // 0.0.0.0/8 "this host"
    a === 10 || // 10.0.0.0/8 private
    a === 127 || // 127.0.0.0/8 loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local + metadata
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 private
    (a === 192 && b === 168) || // 192.168.0.0/16 private
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 benchmarking
    a >= 224 // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  );
}

function isBlockedIpv6(address: string): boolean {
  const ip = address.toLowerCase();
  if (ip === '::1' || ip === '::') {
    return true; // loopback / unspecified
  }
  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded v4 address.
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    return isBlockedIpv4(mapped[1] ?? '');
  }
  const firstHextet = ip.split(':')[0] ?? '';
  return (
    firstHextet.startsWith('fc') || // fc00::/7 unique-local
    firstHextet.startsWith('fd') ||
    firstHextet.startsWith('fe8') || // fe80::/10 link-local
    firstHextet.startsWith('fe9') ||
    firstHextet.startsWith('fea') ||
    firstHextet.startsWith('feb') ||
    firstHextet.startsWith('ff') // ff00::/8 multicast
  );
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
