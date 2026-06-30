/**
 * The wire transport an {@link McpClient} speaks over. Both the stdio and HTTP
 * transports expose the same request/notify primitives so the client's JSON-RPC
 * orchestration (initialize, tools/list, tools/call) is transport-agnostic.
 *
 * `request` resolves with the JSON-RPC `result` value (not the envelope) and
 * rejects on a JSON-RPC error or a transport failure.
 */
export interface McpTransport {
  /** Establish the connection (spawn the process / validate the endpoint). */
  connect(timeoutMs: number): Promise<void>;
  /** Send a request and resolve with its `result`. */
  request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number
  ): Promise<unknown>;
  /** Send a fire-and-forget notification (no response expected). */
  notify(method: string, params?: Record<string, unknown>): void;
  /** Tear down the connection and fail any in-flight requests. */
  close(): void;
}

/** The MCP protocol revision we advertise; servers negotiate down if needed. */
export const PROTOCOL_VERSION = '2025-06-18';

/** How long to wait for the server to start and answer `initialize`. */
export const DEFAULT_CONNECT_TIMEOUT_MS = 20_000;

/** How long a single `tools/call` may take before we give up on it. */
export const DEFAULT_CALL_TIMEOUT_MS = 120_000;

/** A JSON-RPC response envelope, as parsed off either transport. */
export interface JsonRpcResponse {
  id?: number | string | null;
  result?: unknown;
  error?: { message?: string } | null;
}

/**
 * Pulls the `result` out of a JSON-RPC response, throwing on an error envelope.
 * Shared so both transports unwrap replies identically.
 */
export function unwrapResult(message: JsonRpcResponse): unknown {
  if (message.error) {
    throw new Error(message.error.message ?? 'MCP request failed.');
  }
  return message.result;
}
