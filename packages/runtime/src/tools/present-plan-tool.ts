import { ToolName } from '@core/domain/tool-name';
import type {
  Tool,
  ToolDefinition,
  ToolInvocationView,
  ToolResult,
} from '@core/ports/tool';

/**
 * Presents a finished implementation plan to the user. Unlike the file tools
 * this has no workspace side effects — it's a signal: "here is the plan, ready
 * for review." Marking a plan explicitly (rather than inferring it from prose)
 * is what lets the UI attach the "Start implementation" / "Edit plan" actions to
 * a genuine plan and not to an ordinary reply. Primarily used in Plan mode, but
 * available in any mode.
 */
export class PresentPlanTool implements Tool {
  public readonly requiresApproval = false;

  public readonly definition: ToolDefinition = {
    name: ToolName.PresentPlan,
    description:
      'Present a finished, ready-to-review implementation plan to the user. ' +
      'Call this once you have laid out the full plan, passing the complete ' +
      'plan as markdown in `plan`. This does not change anything — it marks the ' +
      'plan so the user can choose to start implementing it. After calling it, ' +
      'stop and wait for the user; do not begin making changes yourself.',
    parameters: {
      type: 'object',
      properties: {
        plan: {
          type: 'string',
          description:
            'The complete implementation plan, as markdown (steps in order, ' +
            'files and functions involved, key decisions and trade-offs).',
        },
      },
      required: ['plan'],
      additionalProperties: false,
    },
  };

  public describe(rawArguments: string): ToolInvocationView {
    const parsed = tryParse(rawArguments);
    if ('error' in parsed) {
      return { title: 'present_plan (invalid arguments)' };
    }
    return { title: 'Plan', preview: parsed.plan };
  }

  public async execute(rawArguments: string): Promise<ToolResult> {
    const parsed = tryParse(rawArguments);
    if ('error' in parsed) {
      return { content: parsed.error, isError: true };
    }
    // Echo the plan back as the tool result: it becomes the transcript's plan
    // card (the UI renders present_plan results specially) and shows the model
    // exactly what it presented.
    return { content: parsed.plan };
  }
}

type ParseResult = { plan: string } | { error: string };

function tryParse(rawArguments: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    return { error: 'Invalid arguments: expected JSON with a "plan" string.' };
  }
  const plan = (parsed as Record<string, unknown>)?.plan;
  if (typeof plan !== 'string' || plan.trim().length === 0) {
    return { error: 'Invalid arguments: "plan" must be a non-empty string.' };
  }
  return { plan };
}
