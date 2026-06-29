import type {
  Tool,
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocationView,
  ToolResult,
} from '@core/ports/tool';
import { MAX_HISTORY_WINDOW } from '@core/application/history-window';
import { ToolName } from '@core/domain/tool-name';

interface ViewHistoryArguments {
  start: number;
  end?: number;
}

/**
 * Lets the model page back into earlier conversation messages that were trimmed
 * from the active request to save tokens (see `/history-limit`). Messages are
 * indexed 0 (oldest) to N-1 (most recent); a request returns the window
 * `[start, end)`.
 *
 * The actual rendering is performed by `ChatSessionService`, which owns the live
 * message list and intercepts this call by name (mirroring `discover_tools`).
 * The `execute` here is only a fallback for when the tool is invoked outside a
 * chat session (e.g. in isolation tests).
 */
export class ViewHistoryTool implements Tool {
  public readonly requiresApproval = false;

  public readonly definition: ToolDefinition = {
    name: ToolName.ViewHistory,
    description:
      'Read earlier messages from this conversation that were trimmed from ' +
      'your active context to save tokens. Messages are indexed 0 (oldest) to ' +
      'N-1 (most recent). Provide "start" and optional "end" (exclusive) to ' +
      `page through them; a single call returns at most ${MAX_HISTORY_WINDOW} ` +
      'messages. Use this only when you need detail from an older turn that is ' +
      'no longer in view. After reading, compact what you retrieved into a ' +
      'short summary of the key facts, decisions, and open threads, and work ' +
      'from that summary going forward rather than re-reading the same range.',
    parameters: {
      type: 'object',
      properties: {
        start: {
          type: 'number',
          description:
            '0-based index of the first message to read (0 = oldest message).',
        },
        end: {
          type: 'number',
          description:
            'Optional 0-based, exclusive end index. Defaults to a bounded ' +
            'window after "start".',
        },
      },
      required: ['start'],
      additionalProperties: false,
    },
  };

  public describe(rawArguments: string): ToolInvocationView {
    const parsed = tryParse(rawArguments);
    if (!parsed) {
      return { title: 'view_history (unparseable arguments)' };
    }
    const range =
      parsed.end === undefined
        ? `from #${parsed.start}`
        : `#${parsed.start}–${parsed.end}`;
    return { title: `view history ${range}` };
  }

  public async execute(
    _rawArguments: string,
    _context: ToolExecutionContext
  ): Promise<ToolResult> {
    return {
      content:
        'Conversation history is only available inside an active chat session.',
      isError: true,
    };
  }
}

function tryParse(rawArguments: string): ViewHistoryArguments | null {
  try {
    const parsed = JSON.parse(rawArguments) as ViewHistoryArguments;
    if (typeof parsed.start !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}
