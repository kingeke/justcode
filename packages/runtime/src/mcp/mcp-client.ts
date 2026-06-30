import { APP_NAME } from '@core/branding';
import { APP_VERSION } from '@core/version';
import type { McpServerConfig } from '@runtime/mcp/mcp-config';
import {
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_CONNECT_TIMEOUT_MS,
  PROTOCOL_VERSION,
  type McpTransport,
} from '@runtime/mcp/mcp-transport';
import { StdioTransport } from '@runtime/mcp/mcp-stdio-transport';
import { HttpTransport } from '@runtime/mcp/mcp-http-transport';

/** A tool as described by an MCP server's `tools/list`. */
export interface McpRemoteTool {
  name: string;
  description?: string;
  /** JSON Schema for the tool's arguments (MCP's `inputSchema`). */
  inputSchema?: Record<string, unknown>;
}

/** The normalized result of a `tools/call`. */
export interface McpCallResult {
  /** Text rendering of the tool's content blocks, joined for the model. */
  content: string;
  isError: boolean;
}

/**
 * A minimal MCP client speaking JSON-RPC 2.0 to a single server. It covers
 * exactly what JustCode needs — `initialize`, `tools/list`, and `tools/call` —
 * rather than the full protocol, so we don't take on the SDK as a dependency
 * (which would complicate the `bun --compile` single-binary build).
 *
 * The wire is handled by a {@link McpTransport} chosen from the config: a
 * `command` runs a local server over stdio; a `url` talks to a remote server
 * over Streamable HTTP. Everything above the transport is identical.
 */
export class McpClient {
  private readonly transport: McpTransport;

  public constructor(
    public readonly serverName: string,
    config: McpServerConfig
  ) {
    this.transport = config.url
      ? new HttpTransport(serverName, config)
      : new StdioTransport(serverName, config);
  }

  /**
   * Opens the transport and completes the MCP handshake (`initialize` then the
   * `notifications/initialized` notification). Rejects (and tears the connection
   * down) if the server can't be reached or doesn't answer in time.
   */
  public async connect(
    timeoutMs: number = DEFAULT_CONNECT_TIMEOUT_MS
  ): Promise<void> {
    await this.transport.connect(timeoutMs);
    await this.transport.request(
      'initialize',
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: APP_NAME, version: APP_VERSION },
      },
      timeoutMs
    );
    this.transport.notify('notifications/initialized');
  }

  /** Lists the tools the server exposes. */
  public async listTools(): Promise<McpRemoteTool[]> {
    const result = (await this.transport.request(
      'tools/list',
      {},
      DEFAULT_CALL_TIMEOUT_MS
    )) as { tools?: McpRemoteTool[] };
    return result.tools ?? [];
  }

  /** Invokes a tool by its (server-local) name with the given arguments. */
  public async callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs: number = DEFAULT_CALL_TIMEOUT_MS
  ): Promise<McpCallResult> {
    const result = (await this.transport.request(
      'tools/call',
      { name, arguments: args },
      timeoutMs
    )) as { content?: unknown; isError?: boolean };
    return {
      content: renderContent(result.content),
      isError: result.isError === true,
    };
  }

  /** Closes the transport and rejects any in-flight requests. */
  public close(): void {
    this.transport.close();
  }
}

/**
 * Flattens MCP content blocks into a single string for the model. Text blocks
 * are concatenated; non-text blocks (images, embedded resources) are summarized
 * since the chat transcript is text-only.
 */
function renderContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((block) => {
      if (typeof block !== 'object' || block === null) return '';
      const typed = block as { type?: string; text?: string };
      if (typed.type === 'text' && typeof typed.text === 'string') {
        return typed.text;
      }
      if (typed.type) return `[${typed.type} content omitted]`;
      return '';
    })
    .filter((part) => part.length > 0)
    .join('\n');
}
