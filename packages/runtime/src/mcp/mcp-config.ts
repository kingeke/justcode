import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { writeSecureFile } from '@runtime/persistence/secure-file';

/**
 * Configuration for a single MCP server, mirroring the shape used by LM Studio,
 * Claude Desktop, and friends so users can paste an existing `mcp.json` entry
 * unchanged. A server is either local (a `command` run over stdio) or remote (a
 * `url` reached over Streamable HTTP):
 *
 * ```json
 * {
 *   "mcpServers": {
 *     "playwright": { "command": "npx", "args": ["@playwright/mcp@latest"] },
 *     "remote": { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer …" } }
 *   }
 * }
 * ```
 *
 * For compatibility with configs written for other tools (e.g. opencode), a
 * local `command` may also be an array of strings — its head is the executable
 * and the tail feeds into `args` — and `enabled: false` is read as `disabled`.
 */
export interface McpServerConfig {
  /** Executable to launch a local server (e.g. `npx`, `uvx`, an absolute path). */
  command?: string;
  /** Arguments passed to the command (local servers only). */
  args?: string[];
  /** Extra environment variables for the spawned process (merged over the parent's). */
  env?: Record<string, string>;
  /** Endpoint of a remote server, reached over Streamable HTTP. */
  url?: string;
  /** Extra HTTP headers for a remote server (e.g. an auth token). */
  headers?: Record<string, string>;
  /**
   * When true, the server is defined but skipped at load time — a convenient way
   * to keep an entry around without launching it.
   */
  disabled?: boolean;
}

/** The parsed `mcp.json`: a map of server name to its launch config. */
export interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>;
}

/** The file name, under the cache/config directory, holding the MCP config. */
export const MCP_CONFIG_FILE_NAME = 'mcp.json';

/** Absolute path to the user's `mcp.json` for a given config directory. */
export function mcpConfigPath(configDirectory: string): string {
  return join(configDirectory, MCP_CONFIG_FILE_NAME);
}

/** The seed contents written when no `mcp.json` exists yet. */
const TEMPLATE: McpConfigFile = { mcpServers: {} };

/**
 * Reads and validates `mcp.json`, returning the configured servers keyed by
 * name. A missing or malformed file yields an empty map rather than throwing —
 * a broken MCP config should never stop the app from starting; the user simply
 * sees no MCP tools until they fix it.
 */
export async function readMcpConfig(
  configDirectory: string
): Promise<Record<string, McpServerConfig>> {
  let raw: string;
  try {
    raw = await readFile(mcpConfigPath(configDirectory), 'utf8');
  } catch {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  return normalizeServers(parsed);
}

/**
 * Ensures `mcp.json` exists, seeding it with an empty template when absent, and
 * returns its path. Used before opening the file in an editor so the user always
 * lands on a valid, editable starting point.
 */
export async function ensureMcpConfigFile(
  configDirectory: string
): Promise<string> {
  const path = mcpConfigPath(configDirectory);
  try {
    await readFile(path, 'utf8');
    return path;
  } catch {
    // mcp.json can hold remote-server bearer headers and per-server env, so it
    // is created owner-only like config.json (see writeSecureFile).
    await writeSecureFile(path, `${JSON.stringify(TEMPLATE, null, 2)}\n`);
    return path;
  }
}

/** Pulls a clean `name -> config` map out of arbitrary parsed JSON. */
function normalizeServers(parsed: unknown): Record<string, McpServerConfig> {
  if (!isRecord(parsed)) return {};
  const servers = parsed.mcpServers;
  if (!isRecord(servers)) return {};

  const result: Record<string, McpServerConfig> = {};
  for (const [name, value] of Object.entries(servers)) {
    if (!isRecord(value)) continue;
    // Some ecosystems (e.g. opencode) write the local launch as a single
    // `command` array — ["/path/to/bin", "--flag"] — rather than command +
    // args. Accept that shape by splitting it, so entries paste unchanged.
    const { command, commandArgs } = normalizeCommand(value.command);
    const hasCommand = command !== undefined;
    const hasUrl = typeof value.url === 'string';
    // Each server must declare exactly one transport: a local command or a
    // remote url. An entry with neither is malformed and skipped.
    if (!hasCommand && !hasUrl) continue;
    const ownArgs = Array.isArray(value.args)
      ? value.args.filter((arg): arg is string => typeof arg === 'string')
      : undefined;
    // Array-command tail first, then any explicit args (rare to have both).
    const args =
      commandArgs || ownArgs
        ? [...(commandArgs ?? []), ...(ownArgs ?? [])]
        : undefined;
    const env = stringRecord(value.env);
    const headers = stringRecord(value.headers);
    // `disabled: true` is ours; `enabled: false` is the same intent expressed by
    // configs from tools that use an enabled flag instead.
    const disabled = value.disabled === true || value.enabled === false;
    result[name] = {
      ...(hasCommand ? { command } : {}),
      ...(hasUrl ? { url: value.url as string } : {}),
      ...(args && args.length > 0 ? { args } : {}),
      ...(env ? { env } : {}),
      ...(headers ? { headers } : {}),
      ...(disabled ? { disabled: true } : {}),
    };
  }
  return result;
}

/**
 * Accepts a local server's `command` as either a string or an array of strings
 * (["/path/bin", "--flag"]); the array's head becomes the command and its tail
 * feeds into `args`.
 */
function normalizeCommand(value: unknown): {
  command?: string;
  commandArgs?: string[];
} {
  if (typeof value === 'string') return { command: value };
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((part): part is string => typeof part === 'string')
  ) {
    return { command: value[0] as string, commandArgs: value.slice(1) };
  }
  return {};
}

/** Keeps only the string-valued entries of a record, or undefined if not one. */
function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
