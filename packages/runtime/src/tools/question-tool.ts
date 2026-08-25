import type {
  Tool,
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocationView,
  ToolResult,
  UserQuestionAnswer,
  UserQuestionItem,
} from '@core/ports/tool';
import { ToolName } from '@core/domain/tool-name';

interface QuestionInput {
  question: string;
  options?: string[];
}

interface QuestionArguments {
  questions: QuestionInput[];
}

/** Cap on how many suggested options are forwarded to the UI, per question. */
const MAX_OPTIONS = 8;
/** Cap on how many questions a single call may put to the user. */
const MAX_QUESTIONS = 5;

/**
 * Asks the user one or more questions and returns their answers to the model.
 * Used when the model needs clarification or a decision before it can proceed.
 * The host renders the batch as a step-through flow (next/previous, review,
 * submit) via the execution context's `askUser` callback; when that isn't
 * available (non-interactive runs) the tool reports that it couldn't ask rather
 * than blocking. It performs no I/O of its own, so it does not require approval.
 */
export class QuestionTool implements Tool {
  public readonly requiresApproval = false;

  public readonly definition: ToolDefinition = {
    name: ToolName.Question,
    description:
      'Ask the user one or more questions and wait for their answers. Use ' +
      'this when you need clarification, a decision, or missing information ' +
      'before you can continue — prefer it over guessing. Batch every ' +
      'related clarification into a single call (up to ' +
      `${MAX_QUESTIONS} questions) instead of asking them one at a time: the ` +
      'user steps through them with next/previous, reviews all answers, then ' +
      'submits. Each question may carry a list of suggested "options" (the ' +
      'user may still type their own answer).',
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: `The questions to ask, in order (max ${MAX_QUESTIONS}).`,
          items: {
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
                  'Optional suggested answers to present as a pick-list. The ' +
                  'user may choose one or type something else.',
              },
            },
            required: ['question'],
            additionalProperties: false,
          },
        },
      },
      required: ['questions'],
      additionalProperties: false,
    },
  };

  public describe(rawArguments: string): ToolInvocationView {
    const parsed = tryParse(rawArguments);
    if (!parsed) {
      return { title: 'question (unparseable arguments)' };
    }
    const first = parsed.questions[0]?.question ?? '';
    const extra = parsed.questions.length - 1;
    const suffix = extra > 0 ? ` (+${extra} more)` : '';
    return {
      title: `question: ${truncate(first, 80)}${suffix}`,
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
        content:
          'Invalid arguments: expected JSON with a "questions" array of ' +
          '{ question, options? } objects.',
        isError: true,
      };
    }

    if (parsed.questions.length === 0) {
      return {
        content: 'Invalid arguments: "questions" must contain at least one.',
        isError: true,
      };
    }

    if (parsed.questions.length > MAX_QUESTIONS) {
      return {
        content:
          `Invalid arguments: at most ${MAX_QUESTIONS} questions per call ` +
          `(got ${parsed.questions.length}). Ask the most important ones now.`,
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

    const questions: UserQuestionItem[] = parsed.questions.map(
      (item, index) => ({
        id: `q${index + 1}`,
        question: item.question,
        ...(item.options ? { options: item.options } : {}),
      })
    );

    try {
      const answers = await context.askUser({ questions });
      return { content: formatAnswers(questions, answers) };
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
    if (!Array.isArray(parsed.questions)) {
      return undefined;
    }
    const questions = parsed.questions
      .map((item) => normalizeQuestion(item))
      .filter((item): item is QuestionInput => item !== undefined);
    return { questions };
  } catch {
    return undefined;
  }
}

/** Keeps a question with a non-empty prompt, trimming it and its options. */
function normalizeQuestion(value: unknown): QuestionInput | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const candidate = value as Partial<QuestionInput>;
  if (typeof candidate.question !== 'string') {
    return undefined;
  }
  const question = candidate.question.trim();
  if (question.length === 0) {
    return undefined;
  }
  const options = normalizeOptions(candidate.options);
  return options ? { question, options } : { question };
}

/** Keep only non-empty string options, trimmed, de-duplicated and capped. */
function normalizeOptions(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const option = item.trim();
    if (option.length === 0 || seen.has(option)) continue;
    seen.add(option);
    if (seen.size === MAX_OPTIONS) break;
  }
  return seen.size > 0 ? [...seen] : undefined;
}

function formatPreview(parsed: QuestionArguments): string {
  return parsed.questions
    .map((item, index) => {
      const head = `${index + 1}. ${item.question}`;
      if (!item.options || item.options.length === 0) {
        return head;
      }
      const options = item.options.map((option) => `   - ${option}`).join('\n');
      return `${head}\n${options}`;
    })
    .join('\n');
}

/** Renders the answers back to the model, pairing each with its question. */
function formatAnswers(
  questions: UserQuestionItem[],
  answers: UserQuestionAnswer[]
): string {
  const byId = new Map(
    answers.map((answer) => [answer.id, answer.answer.trim()])
  );
  const lines = questions.map((item, index) => {
    const answer = byId.get(item.id) ?? '';
    const shown = answer.length > 0 ? answer : '(skipped)';
    return `${index + 1}. ${item.question} → ${shown}`;
  });
  const answered = questions.some(
    (item) => (byId.get(item.id) ?? '').length > 0
  );
  if (!answered) {
    return 'The user did not provide any answers.';
  }
  return `The user answered:\n${lines.join('\n')}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}
