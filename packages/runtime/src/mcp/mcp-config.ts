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
    const hasCommand = typeof value.command === 'string';
    const hasUrl = typeof value.url === 'string';
    // Each server must declare exactly one transport: a local command or a
    // remote url. An entry with neither is malformed and skipped.
    if (!hasCommand && !hasUrl) continue;
    const args = Array.isArray(value.args)
      ? value.args.filter((arg): arg is string => typeof arg === 'string')
      : undefined;
    const env = stringRecord(value.env);
    const headers = stringRecord(value.headers);
    result[name] = {
      ...(hasCommand ? { command: value.command as string } : {}),
      ...(hasUrl ? { url: value.url as string } : {}),
      ...(args ? { args } : {}),
      ...(env ? { env } : {}),
      ...(headers ? { headers } : {}),
      ...(value.disabled === true ? { disabled: true } : {}),
    };
  }
  return result;
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
