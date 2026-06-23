import type { Tool, ToolDefinition } from '@core/ports/tool';

/**
 * Holds the set of tools available to a chat session and exposes the lookups the
 * agentic loop needs: definitions to advertise to the model, and resolution by
 * name when the model requests a call.
 */
export class ToolRegistry {
  private readonly byName: Map<string, Tool>;

  public constructor(tools: Tool[] = []) {
    this.byName = new Map(tools.map((tool) => [tool.definition.name, tool]));
  }

  public list(): Tool[] {
    return [...this.byName.values()];
  }

  public get(name: string): Tool | undefined {
    return this.byName.get(name);
  }

  public definitions(): ToolDefinition[] {
    return this.list().map((tool) => tool.definition);
  }

  public isEmpty(): boolean {
    return this.byName.size === 0;
  }
}
