import type {
  Tool,
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocationView,
  ToolResult,
} from '@core/ports/tool';
import { ToolName } from '@core/domain/tool-name';
import { parseLazyLoadArguments } from '@core/application/lazy-tool-arguments';

export interface LazyLoadableToolDefinition extends ToolDefinition {
  requiresApproval: boolean;
}

/**
 * The gateway the model uses to discover and activate tools under lazy
 * loading. Called with no arguments it returns a catalog of every available
 * tool (name + description); called with `enable`/`disable` lists it toggles
 * which tools' full schemas are advertised on later requests, so each request
 * only carries the schemas the task actually needs.
 *
 * Note: the per-session toggle state lives in the chat session service, which
 * intercepts this call by name (mirroring `view_history`) — this instance is
 * shared across sessions, so it can't hold it. The `execute` here is the
 * standalone fallback for embeddings that run the tool directly; it renders
 * the catalog from the definitions injected at construction and acknowledges
 * toggles without tracking them.
 */
export class LazyLoadToolsTool implements Tool {
  public readonly requiresApproval = false;

  public readonly definition: ToolDefinition = {
    name: ToolName.LazyLoadTools,
    description:
      'Discover and activate tools. Call with no arguments to list every ' +
      'available tool by name (as JSON). Call with ' +
      '{"enable": ["name", …]} to make specific tools callable on later ' +
      'requests, and {"disable": ["name", …]} to drop tools you no longer ' +
      'need so requests stay small. Only enable tools you actually intend ' +
      'to call. Do not call this for normal conversation, explanation, or ' +
      'reasoning-only tasks.',
    parameters: {
      type: 'object',
      properties: {
        enable: {
          type: 'array',
          items: { type: 'string' },
          description: 'Names of tools to activate for later requests.',
        },
        disable: {
          type: 'array',
          items: { type: 'string' },
          description: 'Names of active tools to deactivate.',
        },
      },
      additionalProperties: false,
    },
  };

  public constructor(
    private readonly availableTools: LazyLoadableToolDefinition[]
  ) {}

  public describe(rawArguments: string): ToolInvocationView {
    const { enable, disable } = parseLazyLoadArguments(rawArguments);
    const actions = [
      ...(enable.length > 0 ? [`Enable ${enable.join(', ')}`] : []),
      ...(disable.length > 0 ? [`Disable ${disable.join(', ')}`] : []),
    ];
    return {
      title: ToolName.LazyLoadTools,
      preview:
        actions.length > 0 ? `${actions.join('; ')}.` : 'List available tools.',
    };
  }

  public async execute(
    rawArguments: string,
    _context: ToolExecutionContext
  ): Promise<ToolResult> {
    const { enable, disable } = parseLazyLoadArguments(rawArguments);
    if (enable.length === 0 && disable.length === 0) {
      // Names only — no descriptions. The catalog rides along in history for
      // the rest of the session, so every byte here is paid on every request.
      const catalog = this.availableTools.map((tool) => tool.name);
      return {
        content: [
          'Available tools. Call lazy_load_tools again with {"enable": ["name", …]} to make the ones you need callable; use {"disable": [...]} for tools you no longer need.',
          JSON.stringify(catalog),
        ].join('\n'),
      };
    }
    const actions = [
      ...(enable.length > 0 ? [`Enabled: ${enable.join(', ')}.`] : []),
      ...(disable.length > 0 ? [`Disabled: ${disable.join(', ')}.`] : []),
    ];
    return {
      content: `${actions.join(' ')} Enabled tools are available from the next model request — call the tool you need next.`,
    };
  }
}
