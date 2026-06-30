import type { McpServerConfig } from '@runtime/mcp/mcp-config';
import {
  PROTOCOL_VERSION,
  unwrapResult,
  type JsonRpcResponse,
  type McpTransport,
} from '@runtime/mcp/mcp-transport';

/**
 * Speaks JSON-RPC 2.0 to a remote MCP server over the Streamable HTTP transport:
 * every request is a POST to the server's single endpoint, and the reply comes
 * back either as a JSON body or as a Server-Sent Events stream (the server's
 * choice). Each POST carries its own response, so unlike stdio there's no shared
 * stream to correlate — the awaited fetch *is* the reply.
 *
 * We implement the slice JustCode needs (initialize, tools/list, tools/call,
 * the initialized notification). The negotiated `Mcp-Session-Id` header, when
 * the server issues one, is echoed on every later request.
 */
export class HttpTransport implements McpTransport {
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private sessionId: string | undefined;
  private negotiatedVersion: string | undefined;
  private nextId = 1;
  private closed = false;

  public constructor(
    private readonly serverName: string,
    config: McpServerConfig
  ) {
    if (!config.url) {
      throw new Error(`MCP server "${serverName}" has no url.`);
    }
    this.url = config.url;
    this.headers = config.headers ?? {};
  }

  public async connect(): Promise<void> {
    // Nothing to open ahead of time — the first request (initialize) establishes
    // the session. Validate the URL so a typo fails fast with a clear message.
    try {
      // eslint-disable-next-line no-new
      new URL(this.url);
    } catch {
      throw new Error(
        `MCP server "${this.serverName}" has an invalid url: ${this.url}`
      );
    }
  }

  public async request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number
  ): Promise<unknown> {
    if (this.closed) {
      throw new Error(`MCP server "${this.serverName}" is not running.`);
    }
    const id = this.nextId++;
    const message = await this.send(
      { jsonrpc: '2.0', id, method, params },
      timeoutMs,
      id
    );
    if (!message) {
      throw new Error(`MCP request "${method}" returned no response.`);
    }
    const result = unwrapResult(message);
    // Capture the negotiated protocol version so later requests can advertise it.
    if (method === 'initialize') {
      const version = (result as { protocolVersion?: string } | undefined)
        ?.protocolVersion;
      this.negotiatedVersion = version ?? PROTOCOL_VERSION;
    }
    return result;
  }

  public notify(method: string, params?: Record<string, unknown>): void {
    if (this.closed) return;
    // Fire-and-forget: POST the notification and ignore the (202) response.
    void this.send(
      { jsonrpc: '2.0', method, ...(params ? { params } : {}) },
      DEFAULT_NOTIFY_TIMEOUT_MS,
      undefined
    ).catch(() => {});
  }

  public close(): void {
    this.closed = true;
    // Best-effort: ask the server to drop the session if it issued one.
    if (this.sessionId) {
      void fetch(this.url, {
        method: 'DELETE',
        headers: this.buildHeaders(),
      }).catch(() => {});
    }
  }

  /**
   * POSTs one JSON-RPC message and, when `expectId` is set, returns the matching
   * response (parsed from a JSON body or an SSE stream). Notifications pass
   * `expectId: undefined` and resolve once the POST is accepted.
   */
  private async send(
    body: Record<string, unknown>,
    timeoutMs: number,
    expectId: number | undefined
  ): Promise<JsonRpcResponse | undefined> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const issuedSession = response.headers.get('mcp-session-id');
      if (issuedSession) this.sessionId = issuedSession;

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} ${response.statusText} from ${this.serverName}.`
        );
      }
      if (expectId === undefined) {
        // A notification: drain any body so the connection can be reused.
        await response.body?.cancel().catch(() => {});
        return undefined;
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('text/event-stream')) {
        return await readSseForId(response, expectId);
      }
      const json = (await response.json()) as
        | JsonRpcResponse
        | JsonRpcResponse[];
      return matchResponse(json, expectId);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `MCP request timed out after ${timeoutMs}ms (${this.serverName}).`
        );
      }
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timer);
    }
  }

  private buildHeaders(): Record<string, string> {
    return {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...this.headers,
      ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
      ...(this.negotiatedVersion
        ? { 'mcp-protocol-version': this.negotiatedVersion }
        : {}),
    };
  }
}

/** Notifications shouldn't hang the connection; cap their POST. */
const DEFAULT_NOTIFY_TIMEOUT_MS = 10_000;

/** Picks the response matching `id` from a single object or a JSON-RPC batch. */
function matchResponse(
  payload: JsonRpcResponse | JsonRpcResponse[],
  id: number
): JsonRpcResponse | undefined {
  if (Array.isArray(payload)) {
    return payload.find((entry) => entry.id === id);
  }
  return payload.id === id ? payload : undefined;
}

/**
 * Reads an SSE response and returns the first JSON-RPC message whose id matches,
 * then stops reading (cancelling the stream). Server-initiated notifications and
 * requests interleaved on the stream are ignored — we only need our reply.
 */
async function readSseForId(
  response: Response,
  id: number
): Promise<JsonRpcResponse | undefined> {
  const body = response.body;
  if (!body) return undefined;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line.
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const message = parseSseEvent(rawEvent);
        if (message && message.id === id) {
          return message;
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return undefined;
}

/** Extracts and JSON-parses the `data:` payload of a single SSE event. */
function parseSseEvent(rawEvent: string): JsonRpcResponse | undefined {
  const data = rawEvent
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return undefined;
  try {
    return JSON.parse(data) as JsonRpcResponse;
  } catch {
    return undefined;
  }
}
