import type { Tool, ToolDefinition } from '@core/ports/tool';

export interface AdvertisedToolDefinition extends ToolDefinition {
  requiresApproval?: boolean;
}

/**
 * Holds the set of tools available to a chat session and exposes the lookups the
 * agentic loop needs: definitions to advertise to the model, and resolution by
 * name when the model requests a call.
 */
export class ToolRegistry {
  private readonly byName: Map<string, Tool>;
  private readonly advertisedDefinitions: AdvertisedToolDefinition[];

  public constructor(
    tools: Tool[] = [],
    advertisedDefinitions?: AdvertisedToolDefinition[]
  ) {
    this.byName = new Map(tools.map((tool) => [tool.definition.name, tool]));
    this.advertisedDefinitions =
      advertisedDefinitions ?? tools.map((tool) => tool.definition);
  }

  /**
   * Adds tools after construction. Used to fold in MCP server tools once they
   * finish connecting in the background, so startup isn't blocked on them. The
   * advertised set is intentionally left untouched: the agentic loop derives what
   * to advertise from `list()` each turn (and, in lazy mode, only the gateway is
   * advertised up front), so newly added tools become available on the next turn
   * without re-advertising them eagerly.
   */
  public add(tools: Tool[]): void {
    for (const tool of tools) {
      this.byName.set(tool.definition.name, tool);
    }
  }

  /**
   * Removes every executable tool whose name matches the predicate. Used to drop
   * a previous batch of MCP tools before reconnecting servers, so a removed
   * server's tools don't linger. The advertised set is left untouched (MCP tools
   * are never advertised eagerly — they're added via {@link add}).
   */
  public removeWhere(predicate: (name: string) => boolean): void {
    for (const name of [...this.byName.keys()]) {
      if (predicate(name)) this.byName.delete(name);
    }
  }

  public list(): Tool[] {
    return [...this.byName.values()];
  }

  public get(name: string): Tool | undefined {
    return this.byName.get(name);
  }

  public definitions(): AdvertisedToolDefinition[] {
    return [...this.advertisedDefinitions];
  }

  public isEmpty(): boolean {
    return this.byName.size === 0;
  }
}
