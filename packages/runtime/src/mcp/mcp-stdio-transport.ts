import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import type { McpServerConfig } from '@runtime/mcp/mcp-config';
import {
  unwrapResult,
  type JsonRpcResponse,
  type McpTransport,
} from '@runtime/mcp/mcp-transport';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Environment variable names that look like secrets and should not be inherited
 * by third-party MCP server processes. A stdio server is arbitrary local code
 * (from a user-editable, pasteable `mcp.json`); there's no reason it should see
 * the API keys/tokens the user exported for other tools. Anything a server
 * legitimately needs can be granted explicitly via the server's `env` config.
 */
const SECRET_ENV_PATTERN = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i;

/**
 * Builds the environment for a spawned stdio MCP server: the parent environment
 * minus secret-shaped variables, with the server's configured `env` overlaid on
 * top (so an explicitly-configured secret still passes through). Exposed for
 * testing.
 */
export function buildStdioEnv(
  configEnv: Record<string, string> | undefined,
  sourceEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const scoped: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (value === undefined || SECRET_ENV_PATTERN.test(key)) {
      continue;
    }
    scoped[key] = value;
  }
  return { ...scoped, ...configEnv };
}

/**
 * Speaks JSON-RPC 2.0 to a local MCP server over a child process's stdio, using
 * MCP's newline-delimited framing (one JSON message per line). Requests are
 * correlated to responses by id over the long-lived stdout stream.
 */
export class StdioTransport implements McpTransport {
  private child: ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  /** Carries partial stdout between data events until a full line arrives. */
  private stdoutBuffer = '';
  private closed = false;

  public constructor(
    private readonly serverName: string,
    private readonly config: McpServerConfig
  ) {}

  public async connect(): Promise<void> {
    if (!this.config.command) {
      throw new Error(`MCP server "${this.serverName}" has no command.`);
    }
    const child = spawn(this.config.command, this.config.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildStdioEnv(this.config.env),
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
  }

  public request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number
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

  public notify(method: string, params?: Record<string, unknown>): void {
    if (this.closed || !this.child) return;
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) })}\n`
    );
  }

  public close(): void {
    this.closed = true;
    this.child?.kill();
    this.failAll(new Error(`MCP server "${this.serverName}" was closed.`));
    this.child = undefined;
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
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return; // Not JSON-RPC (e.g. a stray log line) — ignore it.
    }
    if (typeof message.id !== 'number') return; // A notification, not a reply.

    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);

    try {
      pending.resolve(unwrapResult(message));
    } catch (error) {
      pending.reject(error as Error);
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
