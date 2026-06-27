import type {
  Tool,
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocationView,
  ToolResult,
} from '@core/ports/tool';

export interface DiscoverableToolDefinition extends ToolDefinition {
  requiresApproval: boolean;
}

export class DiscoverToolsTool implements Tool {
  public readonly requiresApproval = false;

  public readonly definition: ToolDefinition = {
    name: 'discover_tools',
    description:
      "Call this only when the user's request appears to require tools and you " +
      'need the full toolset revealed before continuing. Do not call this for ' +
      'normal conversation, explanation, or reasoning-only tasks. This tool ' +
      'takes no arguments.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  };

  public constructor(
    private readonly availableTools: DiscoverableToolDefinition[]
  ) {}

  public describe(_rawArguments: string): ToolInvocationView {
    return {
      title: 'discover_tools',
      preview: 'Reveal the full toolset for the next model request.',
    };
  }

  public async execute(
    rawArguments: string,
    _context: ToolExecutionContext
  ): Promise<ToolResult> {
    const trimmed = rawArguments.trim();
    if (trimmed && trimmed !== '{}') {
      return {
        content:
          'Invalid arguments: discover_tools takes no arguments. Call it with an empty object.',
        isError: true,
      };
    }

    return {
      content:
        'Tool discovery acknowledged. The full toolset will now be available on the next model request. Call the actual tool you need next.',
    };
  }
}
