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
