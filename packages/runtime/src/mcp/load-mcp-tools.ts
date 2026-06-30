import type { Tool } from '@core/ports/tool';
import type { ToolDisplay } from '@core/domain/tool-metadata';
import { logDebug } from '@core/application/debug-log';
import { McpClient } from '@runtime/mcp/mcp-client';
import { McpTool, mcpToolName } from '@runtime/mcp/mcp-tool';
import { readMcpConfig, type McpServerConfig } from '@runtime/mcp/mcp-config';

/** The category heading MCP tools are grouped under, one per server. */
export function mcpCategory(serverName: string): string {
  return `MCP: ${serverName}`;
}

/** Outcome of attempting to load one MCP server, for UI feedback. */
export interface McpServerLoadInfo {
  name: string;
  /** Whether the server connected and listed its tools. */
  ok: boolean;
  /** How many tools the server exposed (0 when it failed). */
  toolCount: number;
  /** The failure reason, when `ok` is false. */
  error?: string;
}

export interface LoadedMcpTools {
  /** The MCP tools, ready to register alongside the built-in toolset. */
  tools: Tool[];
  /** Manage-tools display metadata for each tool, grouped by server category. */
  displays: ToolDisplay[];
  /** Per-server load outcome, in config order, for surfacing in the UI. */
  servers: McpServerLoadInfo[];
  /** Tears down every spawned server process; call on shutdown. */
  dispose: () => void;
}

const EMPTY: LoadedMcpTools = {
  tools: [],
  displays: [],
  servers: [],
  dispose: () => {},
};

/**
 * Reads `mcp.json`, launches each configured server, and turns the tools they
 * expose into {@link McpTool}s plus their manage-tools display metadata. Servers
 * are connected in parallel; any that fails to launch or list tools is logged
 * and skipped so one broken server never blocks the others (or app startup).
 */
export async function loadMcpTools(
  configDirectory: string
): Promise<LoadedMcpTools> {
  const configured = await readMcpConfig(configDirectory);
  const entries = Object.entries(configured).filter(
    ([, config]) => config.disabled !== true
  );
  if (entries.length === 0) return EMPTY;

  const clients: McpClient[] = [];
  const tools: Tool[] = [];
  const displays: ToolDisplay[] = [];

  // Connect in parallel but keep the summary in config order so the UI lists
  // servers the way the user wrote them.
  const results = await Promise.all(
    entries.map(([name, config]) => loadServer(name, config))
  );

  const servers: McpServerLoadInfo[] = results.map((loaded) => {
    if (loaded.client) clients.push(loaded.client);
    tools.push(...loaded.tools);
    displays.push(...loaded.displays);
    return loaded.info;
  });

  return {
    tools,
    displays,
    servers,
    dispose: () => {
      for (const client of clients) client.close();
    },
  };
}

interface LoadedServer {
  client: McpClient | undefined;
  tools: Tool[];
  displays: ToolDisplay[];
  info: McpServerLoadInfo;
}

async function loadServer(
  name: string,
  config: McpServerConfig
): Promise<LoadedServer> {
  const client = new McpClient(name, config);
  try {
    await client.connect();
    const remoteTools = await client.listTools();
    const tools: Tool[] = [];
    const displays: ToolDisplay[] = [];
    for (const remote of remoteTools) {
      tools.push(new McpTool(client, name, remote));
      displays.push({
        name: mcpToolName(name, remote.name),
        label: remote.name,
        category: mcpCategory(name),
        summary: summarize(remote.description) ?? `${name} tool`,
      });
    }
    return {
      client,
      tools,
      displays,
      info: { name, ok: true, toolCount: tools.length },
    };
  } catch (error) {
    client.close();
    const reason = error instanceof Error ? error.message : String(error);
    void logDebug(`MCP server "${name}" failed to load: ${reason}`);
    return {
      client: undefined,
      tools: [],
      displays: [],
      info: { name, ok: false, toolCount: 0, error: reason },
    };
  }
}

/** First line of a description, trimmed to a one-liner for the manage-tools UI. */
function summarize(description: string | undefined): string | undefined {
  if (!description) return undefined;
  const firstLine = description.split(/\r?\n/, 1)[0]?.trim() ?? '';
  if (!firstLine) return undefined;
  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
}
