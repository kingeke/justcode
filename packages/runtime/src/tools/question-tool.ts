import type {
  Tool,
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocationView,
  ToolResult,
} from '@core/ports/tool';

interface QuestionArguments {
  question: string;
  options?: string[];
}

/** Cap on how many suggested options are forwarded to the UI. */
const MAX_OPTIONS = 8;

/**
 * Asks the user a question and returns their answer to the model. Used when the
 * model needs clarification or a decision before it can proceed. The actual
 * prompting is done by the host via the execution context's `askUser` callback;
 * when that isn't available (non-interactive runs) the tool reports that it
 * couldn't ask rather than blocking. It performs no I/O of its own, so it does
 * not require approval.
 */
export class QuestionTool implements Tool {
  public readonly requiresApproval = false;

  public readonly definition: ToolDefinition = {
    name: 'question',
    description:
      'Ask the user a question and wait for their answer. Use this when you ' +
      'need clarification, a decision, or missing information before you can ' +
      'continue — prefer it over guessing. Provide a "question" string and, ' +
      'optionally, a list of suggested "options" the user can pick from (they ' +
      'may still type their own answer).',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question to put to the user.',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional suggested answers to present as a pick-list. The user ' +
            'may choose one or type something else.',
        },
      },
      required: ['question'],
      additionalProperties: false,
    },
  };

  public describe(rawArguments: string): ToolInvocationView {
    const parsed = tryParse(rawArguments);
    if (!parsed) {
      return { title: 'question (unparseable arguments)' };
    }
    return {
      title: `question: ${truncate(parsed.question, 80)}`,
      preview: formatPreview(parsed),
    };
  }

  public async execute(
    rawArguments: string,
    context?: ToolExecutionContext
  ): Promise<ToolResult> {
    const parsed = tryParse(rawArguments);
    if (!parsed) {
      return {
        content: 'Invalid arguments: expected JSON with a "question" string.',
        isError: true,
      };
    }

    const question = parsed.question.trim();
    if (question.length === 0) {
      return {
        content: 'Invalid arguments: "question" must be a non-empty string.',
        isError: true,
      };
    }

    if (!context?.askUser) {
      return {
        content:
          'Cannot ask the user a question in this non-interactive context.',
        isError: true,
      };
    }

    try {
      const answer = await context.askUser({
        question,
        ...(parsed.options ? { options: parsed.options } : {}),
      });
      const trimmed = answer.trim();
      if (trimmed.length === 0) {
        return { content: 'The user did not provide an answer.' };
      }
      return { content: `The user answered: ${trimmed}` };
    } catch (error: unknown) {
      // A cancellation (e.g. the user interrupted the turn) propagates so the
      // agentic loop unwinds; any other failure is reported back to the model.
      if (isAbortError(error)) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Failed to ask the user: ${message}`, isError: true };
    }
  }
}

function tryParse(rawArguments: string): QuestionArguments | undefined {
  try {
    const parsed = JSON.parse(rawArguments) as Partial<QuestionArguments>;
    if (typeof parsed.question !== 'string') {
      return undefined;
    }
    const options = normalizeOptions(parsed.options);
    return options
      ? { question: parsed.question, options }
      : { question: parsed.question };
  } catch {
    return undefined;
  }
}

/** Keep only non-empty string options, trimmed and capped. */
function normalizeOptions(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const options = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, MAX_OPTIONS);
  return options.length > 0 ? options : undefined;
}

function formatPreview(parsed: QuestionArguments): string {
  if (!parsed.options || parsed.options.length === 0) {
    return parsed.question;
  }
  const options = parsed.options
    .map((option, index) => `${index + 1}. ${option}`)
    .join('\n');
  return `${parsed.question}\n${options}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}
