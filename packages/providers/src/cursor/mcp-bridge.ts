import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { createServer, type Server as HttpServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import type { ToolDefinition, ToolResult } from '@core/ports/tool';
import type { ToolCall } from '@core/domain/message';

/**
 * MCP server name as registered in the generated `mcp.json`. Cursor surfaces
 * the tools to the model as `justcode-<tool>` but MCP `tools/call` requests
 * arrive with the plain tool name.
 */
export const CURSOR_MCP_SERVER_NAME = 'justcode';

/**
 * Built-in permission denials for the generated project `cli.json`. Print mode
 * (`-p --force`) honors deny rules, and deny takes precedence over allow, so
 * these suppress Cursor's own file/shell/web tools — justcode's engine owns
 * tool execution. Cursor's permission tokens cover only Shell/Read/Write/
 * Delete/WebFetch/Mcp; the read-only search built-ins (grep, glob, ls) cannot
 * be denied and remain available to the model. That is a deliberate, harmless
 * leak: they cannot modify anything and only see the ephemeral workspace.
 */
const BUILTIN_DENY_RULES = [
  'Shell(*)',
  'Write(**)',
  'Read(**)',
  'Delete(**)',
  'WebFetch(*)',
];

/**
 * Serves justcode's tools to the Cursor CLI over a loopback streamable-HTTP
 * MCP endpoint. The `tools/call` handler *parks*: it forwards the invocation
 * to {@link onToolCall} (which the provider resolves with the engine's result
 * on a later `sendChat`) and blocks the CLI turn until then — verified against
 * the real CLI, which keeps the turn open across long MCP calls.
 *
 * The stateful transport (`sessionIdGenerator` + `enableJsonResponse`) is
 * required: the Cursor CLI silently drops stateless/SSE-only endpoints after
 * `initialize`.
 */
export class CursorMcpBridge {
  /** Latest definitions served by the ListTools handler; mutable per request. */
  public toolDefinitions: ToolDefinition[] = [];
  private httpServer: HttpServer | undefined;
  private listeningPort: number | undefined;
  /**
   * One transport (and Server) per MCP session. Every spawned CLI process
   * opens its own MCP session with a fresh `initialize`; a single stateful
   * transport would be claimed by the first process and silently reject every
   * later one — leaving all turns after the first without tools.
   */
  private readonly transports = new Map<
    string,
    StreamableHTTPServerTransport
  >();
  private readonly servers = new Set<Server>();

  public constructor(
    private readonly onToolCall: (call: ToolCall) => Promise<ToolResult>
  ) {}

  public get port(): number {
    if (this.listeningPort === undefined) {
      throw new Error('Cursor MCP bridge is not started.');
    }
    return this.listeningPort;
  }

  /** A fresh MCP Server wired to the live tool definitions and call parking. */
  private buildServer(): Server {
    const mcp = new Server(
      { name: CURSOR_MCP_SERVER_NAME, version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    mcp.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: this.toolDefinitions.map((definition) => ({
        name: definition.name,
        description: definition.description,
        inputSchema: definition.parameters as {
          type: 'object';
          [key: string]: unknown;
        },
      })),
    }));
    mcp.setRequestHandler(CallToolRequestSchema, async (call) => {
      const result = await this.onToolCall({
        id: `call_${randomUUID()}`,
        name: call.params.name,
        arguments: JSON.stringify(call.params.arguments ?? {}),
      });
      return {
        content: [{ type: 'text' as const, text: result.content }],
        ...(result.isError ? { isError: true } : {}),
      };
    });
    return mcp;
  }

  /** Routes one HTTP request to its session's transport, creating it on init. */
  private async dispatch(
    request: Parameters<StreamableHTTPServerTransport['handleRequest']>[0],
    response: Parameters<StreamableHTTPServerTransport['handleRequest']>[1],
    body: unknown
  ): Promise<void> {
    const sessionId = request.headers['mcp-session-id'];
    let transport =
      typeof sessionId === 'string'
        ? this.transports.get(sessionId)
        : undefined;
    if (!transport) {
      // A new CLI process initializing its own MCP session.
      const created = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (id) => {
          this.transports.set(id, created);
        },
      });
      created.onclose = () => {
        for (const [id, value] of this.transports) {
          if (value === created) this.transports.delete(id);
        }
      };
      const server = this.buildServer();
      this.servers.add(server);
      // Cast: exactOptionalPropertyTypes flags the SDK's own transport class
      // against its Transport interface (`onclose` optionality) — a known
      // SDK-internal mismatch, not a real incompatibility.
      await server.connect(
        created as unknown as Parameters<typeof server.connect>[0]
      );
      transport = created;
    }
    await transport.handleRequest(request, response, body);
  }

  public async start(): Promise<void> {
    if (this.listeningPort !== undefined) return;
    const httpServer = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      request.on('end', () => {
        void this.dispatch(
          request,
          response,
          body ? (JSON.parse(body) as unknown) : undefined
        ).catch(() => {
          if (!response.headersSent) response.writeHead(500).end();
        });
      });
    });
    this.httpServer = httpServer;
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(0, '127.0.0.1', () => {
        const address = httpServer.address();
        if (address && typeof address === 'object') {
          this.listeningPort = address.port;
        }
        resolve();
      });
    });
  }

  public async close(): Promise<void> {
    for (const server of this.servers) {
      await server.close().catch(() => {});
    }
    this.servers.clear();
    this.transports.clear();
    const httpServer = this.httpServer;
    this.httpServer = undefined;
    this.listeningPort = undefined;
    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeAllConnections?.();
      });
    }
  }
}

/** An ephemeral Cursor project directory the CLI is pointed at as its cwd. */
export interface CursorSessionWorkspace {
  directory: string;
  cleanup: () => Promise<void>;
}

/**
 * Deny rules for every MCP server in the user's global `~/.cursor/mcp.json`.
 * The CLI always loads user-level servers (no strict-config switch exists),
 * and a wildcard `Mcp(*:*)` deny would also block justcode's bridge (deny
 * beats allow), so each foreign server is denied by name. Denied tools are
 * still listed to the model but cannot execute.
 */
export async function foreignMcpDenyRules(): Promise<string[]> {
  try {
    const raw = await readFile(join(homedir(), '.cursor', 'mcp.json'), 'utf8');
    const parsed = JSON.parse(raw) as {
      mcpServers?: Record<string, unknown>;
    };
    return Object.keys(parsed.mcpServers ?? {})
      .filter((name) => name !== CURSOR_MCP_SERVER_NAME)
      .map((name) => `Mcp(${name}:*)`);
  } catch {
    return [];
  }
}

/**
 * Creates the ephemeral project directory a Cursor CLI turn runs in:
 * `.cursor/mcp.json` registers the loopback bridge (omitted for tool-less
 * ephemeral runs) and `.cursor/cli.json` carries the permission denials.
 * Project-level config is used deliberately — `CURSOR_CONFIG_DIR` is left
 * alone so the user's own login always resolves, and the user's real
 * workspace is never touched.
 */
export async function createCursorWorkspace(options: {
  mcpPort?: number;
  denyAllMcp?: boolean;
}): Promise<CursorSessionWorkspace> {
  const directory = await mkdtemp(join(tmpdir(), 'justcode-cursor-'));
  const cursorDir = join(directory, '.cursor');
  await mkdir(cursorDir, { recursive: true });

  const deny = [...BUILTIN_DENY_RULES];
  if (options.denyAllMcp) {
    deny.push('Mcp(*:*)');
  } else {
    deny.push(...(await foreignMcpDenyRules()));
  }
  const permissions = {
    allow: options.denyAllMcp ? [] : [`Mcp(${CURSOR_MCP_SERVER_NAME}:*)`],
    deny,
  };
  await writeFile(
    join(cursorDir, 'cli.json'),
    `${JSON.stringify({ permissions }, null, 2)}\n`,
    'utf8'
  );

  if (options.mcpPort !== undefined) {
    const mcpConfig = {
      mcpServers: {
        [CURSOR_MCP_SERVER_NAME]: {
          url: `http://127.0.0.1:${options.mcpPort}/mcp`,
        },
      },
    };
    await writeFile(
      join(cursorDir, 'mcp.json'),
      `${JSON.stringify(mcpConfig, null, 2)}\n`,
      'utf8'
    );
  }

  return {
    directory,
    cleanup: async () => {
      await rm(directory, { recursive: true, force: true }).catch(() => {});
    },
  };
}
