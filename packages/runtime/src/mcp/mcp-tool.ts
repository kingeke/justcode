import type {
  Tool,
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocationView,
  ToolResult,
} from '@core/ports/tool';
import type { McpClient, McpRemoteTool } from '@runtime/mcp/mcp-client';

/** The prefix that namespaces every MCP tool name (Claude's convention). */
export const MCP_TOOL_PREFIX = 'mcp__';

/**
 * Builds the advertised, namespaced tool name for a server's tool, e.g.
 * `mcp__playwright__browser_navigate`. Namespacing by server keeps two servers
 * that expose a same-named tool from colliding, and lets the manage-tools UI and
 * `disabledTools` target a server's tools by their shared `mcp__<server>__` stem.
 */
export function mcpToolName(serverName: string, toolName: string): string {
  return `${MCP_TOOL_PREFIX}${serverName}__${toolName}`;
}

/**
 * Adapts a single tool exposed by an MCP server to JustCode's {@link Tool} port,
 * so the agentic loop can advertise and invoke it exactly like a built-in tool.
 * Calls always require approval — an MCP tool runs arbitrary external code with
 * side effects — subject to the usual global auto-approve toggle.
 */
export class McpTool implements Tool {
  public readonly requiresApproval = true;
  public readonly definition: ToolDefinition;

  public constructor(
    private readonly client: McpClient,
    public readonly serverName: string,
    private readonly remote: McpRemoteTool
  ) {
    this.definition = {
      name: mcpToolName(serverName, remote.name),
      description:
        remote.description ??
        `The "${remote.name}" tool from the "${serverName}" MCP server.`,
      parameters: normalizeSchema(remote.inputSchema),
    };
  }

  public describe(rawArguments: string): ToolInvocationView {
    const title = `${this.serverName}: ${this.remote.name}`;
    const preview = rawArguments.trim();
    return preview && preview !== '{}' ? { title, preview } : { title };
  }

  public async execute(
    rawArguments: string,
    context?: ToolExecutionContext
  ): Promise<ToolResult> {
    if (context?.signal?.aborted) {
      return { content: 'The tool call was cancelled.', isError: true };
    }

    let args: Record<string, unknown>;
    try {
      const parsed = rawArguments.trim() ? JSON.parse(rawArguments) : {};
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return {
          content: 'Invalid arguments: expected a JSON object.',
          isError: true,
        };
      }
      args = parsed as Record<string, unknown>;
    } catch {
      return {
        content: 'Invalid arguments: expected a JSON object.',
        isError: true,
      };
    }

    try {
      const result = await this.client.callTool(this.remote.name, args);
      return {
        content: result.content || '(the tool returned no content)',
        isError: result.isError,
      };
    } catch (error) {
      return {
        content: `MCP tool failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        isError: true,
      };
    }
  }
}

/**
 * Ensures the schema advertised to the model is a usable JSON Schema object.
 * Some servers omit `inputSchema` or send a non-object; fall back to an open
 * object so the provider's function-calling layer always gets valid parameters.
 */
function normalizeSchema(
  schema: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (schema && typeof schema === 'object' && schema.type === 'object') {
    return schema;
  }
  return { type: 'object', properties: {}, additionalProperties: true };
}
