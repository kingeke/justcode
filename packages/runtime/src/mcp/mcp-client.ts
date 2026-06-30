import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { APP_NAME } from '@core/branding';
import { APP_VERSION } from '@core/version';
import type { McpServerConfig } from '@runtime/mcp/mcp-config';

/** The MCP protocol revision we advertise; servers negotiate down if needed. */
const PROTOCOL_VERSION = '2025-06-18';

/** How long to wait for the server to start and answer `initialize`. */
const DEFAULT_CONNECT_TIMEOUT_MS = 20_000;
/** How long a single `tools/call` may take before we give up on it. */
const DEFAULT_CALL_TIMEOUT_MS = 120_000;

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

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * A minimal MCP client speaking JSON-RPC 2.0 over a child process's stdio,
 * using MCP's newline-delimited framing (one JSON message per line). It covers
 * exactly what JustCode needs — `initialize`, `tools/list`, and `tools/call` —
 * rather than the full protocol, so we don't take on the SDK as a dependency
 * (which would complicate the `bun --compile` single-binary build).
 */
export class McpClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  /** Carries partial stdout between data events until a full line arrives. */
  private stdoutBuffer = '';
  private closed = false;

  public constructor(
    public readonly serverName: string,
    private readonly config: McpServerConfig
  ) {}

  /**
   * Spawns the server and completes the MCP handshake (`initialize` then the
   * `notifications/initialized` notification). Rejects (and tears the process
   * down) if the server can't be launched or doesn't answer in time.
   */
  public async connect(
    timeoutMs: number = DEFAULT_CONNECT_TIMEOUT_MS
  ): Promise<void> {
    const child = spawn(this.config.command, this.config.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.config.env },
    });
    this.child = child;

    child.on('error', (error) => this.failAll(error));
    child.on('exit', () => {
      this.closed = true;
      this.failAll(new Error(`MCP server "${this.serverName}" exited.`));
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    // Drain stderr so a chatty server can't fill its pipe buffer and stall.
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', () => {});

    await this.request(
      'initialize',
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: APP_NAME, version: APP_VERSION },
      },
      timeoutMs
    );
    this.notify('notifications/initialized');
  }

  /** Lists the tools the server exposes. */
  public async listTools(): Promise<McpRemoteTool[]> {
    const result = (await this.request('tools/list', {})) as {
      tools?: McpRemoteTool[];
    };
    return result.tools ?? [];
  }

  /** Invokes a tool by its (server-local) name with the given arguments. */
  public async callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs: number = DEFAULT_CALL_TIMEOUT_MS
  ): Promise<McpCallResult> {
    const result = (await this.request(
      'tools/call',
      { name, arguments: args },
      timeoutMs
    )) as { content?: unknown; isError?: boolean };
    return {
      content: renderContent(result.content),
      isError: result.isError === true,
    };
  }

  /** Terminates the server process and rejects any in-flight requests. */
  public close(): void {
    this.closed = true;
    this.child?.kill();
    this.failAll(new Error(`MCP server "${this.serverName}" was closed.`));
    this.child = undefined;
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number = DEFAULT_CALL_TIMEOUT_MS
  ): Promise<unknown> {
    if (this.closed || !this.child) {
      return Promise.reject(
        new Error(`MCP server "${this.serverName}" is not running.`)
      );
    }
    const id = this.nextId++;
    const payload = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`MCP request "${method}" timed out after ${timeoutMs}ms.`)
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child?.stdin.write(payload, (error) => {
        if (error) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  private notify(method: string): void {
    if (this.closed || !this.child) return;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newlineIndex = this.stdoutBuffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line) this.handleMessage(line);
      newlineIndex = this.stdoutBuffer.indexOf('\n');
    }
  }

  private handleMessage(line: string): void {
    let message: {
      id?: number;
      result?: unknown;
      error?: { message?: string };
    };
    try {
      message = JSON.parse(line);
    } catch {
      return; // Not JSON-RPC (e.g. a stray log line) — ignore it.
    }
    if (typeof message.id !== 'number') return; // A notification, not a reply.

    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);

    if (message.error) {
      pending.reject(new Error(message.error.message ?? 'MCP request failed.'));
      return;
    }
    pending.resolve(message.result);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
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
