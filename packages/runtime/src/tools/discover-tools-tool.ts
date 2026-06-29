import type {
  Tool,
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocationView,
  ToolResult,
} from '@core/ports/tool';
import { ToolName } from '@core/domain/tool-name';

export interface DiscoverableToolDefinition extends ToolDefinition {
  requiresApproval: boolean;
}

export class DiscoverToolsTool implements Tool {
  public readonly requiresApproval = false;

  public readonly definition: ToolDefinition = {
    name: ToolName.DiscoverTools,
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
      title: ToolName.DiscoverTools,
      preview: 'Reveal the full toolset for the next model request.',
    };
  }

  public async execute(
    _rawArguments: string,
    _context: ToolExecutionContext
  ): Promise<ToolResult> {
    // discover_tools takes no arguments, but models sometimes pass one by
    // accident (e.g. a stray `{"tool":"…"}`). That's harmless — revealing the
    // toolset doesn't depend on any input — so ignore whatever was passed and
    // always succeed rather than bouncing the turn with an error.
    return {
      content:
        'Tool discovery acknowledged. The full toolset will now be available on the next model request. Call the actual tool you need next.',
    };
  }
}
