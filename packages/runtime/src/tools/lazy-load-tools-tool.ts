import type {
  Tool,
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocationView,
  ToolResult,
} from '@core/ports/tool';
import { ToolName } from '@core/domain/tool-name';

export interface LazyLoadableToolDefinition extends ToolDefinition {
  requiresApproval: boolean;
}

export class LazyLoadToolsTool implements Tool {
  public readonly requiresApproval = false;

  public readonly definition: ToolDefinition = {
    name: ToolName.LazyLoadTools,
    description:
      "Call this only when the user's request appears to require tools and you " +
      'need the full toolset loaded before continuing. Do not call this for ' +
      'normal conversation, explanation, or reasoning-only tasks. This tool ' +
      'takes no arguments.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  };

  public constructor(
    private readonly availableTools: LazyLoadableToolDefinition[]
  ) {}

  public describe(_rawArguments: string): ToolInvocationView {
    return {
      title: ToolName.LazyLoadTools,
      preview: 'Load the full toolset for the next model request.',
    };
  }

  public async execute(
    _rawArguments: string,
    _context: ToolExecutionContext
  ): Promise<ToolResult> {
    // lazy_load_tools takes no arguments, but models sometimes pass one by
    // accident (e.g. a stray `{"tool":"…"}`). That's harmless — loading the
    // toolset doesn't depend on any input — so ignore whatever was passed and
    // always succeed rather than bouncing the turn with an error.
    return {
      content:
        'Tool loading acknowledged. The full toolset will now be available on the next model request. Call the actual tool you need next.',
    };
  }
}
