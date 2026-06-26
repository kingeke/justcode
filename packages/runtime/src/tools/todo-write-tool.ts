import type {
  Tool,
  ToolDefinition,
  ToolInvocationView,
  ToolResult,
} from '@core/ports/tool';

/** The lifecycle states a todo can be in. */
export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoItem {
  content: string;
  status: TodoStatus;
}

const STATUS_VALUES: readonly TodoStatus[] = [
  'pending',
  'in_progress',
  'completed',
];

/** Marker shown for each status when the list is rendered as text. */
const STATUS_MARKER: Record<TodoStatus, string> = {
  pending: '[ ]',
  in_progress: '[~]',
  completed: '[x]',
};

/**
 * Records the agent's task list for the current turn. Unlike the file tools this
 * has no workspace side effects: each call carries the *entire* up-to-date list,
 * which replaces the previous one. The model uses it to plan multi-step work and
 * to surface progress; the CLI renders the latest list in a pinned panel. The
 * tool itself just validates the list and echoes a rendered view back to the
 * model so it can see the state it just set.
 */
export class TodoWriteTool implements Tool {
  public readonly requiresApproval = false;

  public readonly definition: ToolDefinition = {
    name: 'todowrite',
    description:
      'Create or update the task list for the current piece of work. Pass the ' +
      'COMPLETE list every time — it replaces the previous one. Use this to ' +
      'plan multi-step tasks and to keep the user informed of progress: add ' +
      'items as "pending", mark exactly one item "in_progress" while you work ' +
      'on it, and flip it to "completed" as soon as it is done. Keep at most ' +
      'one item "in_progress" at a time. Skip it for trivial single-step ' +
      'requests.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'The full, ordered task list.',
          items: {
            type: 'object',
            properties: {
              content: {
                type: 'string',
                description: 'Short description of the task.',
              },
              status: {
                type: 'string',
                enum: [...STATUS_VALUES],
                description: 'One of "pending", "in_progress", or "completed".',
              },
            },
            required: ['content', 'status'],
            additionalProperties: false,
          },
        },
      },
      required: ['todos'],
      additionalProperties: false,
    },
  };

  public describe(rawArguments: string): ToolInvocationView {
    const parsed = tryParse(rawArguments);
    if ('error' in parsed) {
      return { title: 'todowrite (invalid arguments)' };
    }
    const { todos } = parsed;
    const done = todos.filter((todo) => todo.status === 'completed').length;
    const title =
      todos.length === 0
        ? 'Clear todos'
        : `Update todos (${done}/${todos.length} done)`;
    return { title, preview: renderTodos(todos) };
  }

  public async execute(rawArguments: string): Promise<ToolResult> {
    const parsed = tryParse(rawArguments);
    if ('error' in parsed) {
      return { content: parsed.error, isError: true };
    }

    const { todos } = parsed;
    if (todos.length === 0) {
      return { content: 'Todo list cleared.' };
    }
    return { content: `Updated todo list:\n${renderTodos(todos)}` };
  }
}

/** Render the list as a simple status-marked checklist. */
function renderTodos(todos: readonly TodoItem[]): string {
  return todos
    .map((todo) => `${STATUS_MARKER[todo.status]} ${todo.content}`)
    .join('\n');
}

type ParseResult = { todos: TodoItem[] } | { error: string };

function tryParse(rawArguments: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    return { error: 'Invalid arguments: expected JSON with a "todos" array.' };
  }

  const todosValue = (parsed as Record<string, unknown>)?.todos;
  if (!Array.isArray(todosValue)) {
    return { error: 'Invalid arguments: "todos" must be an array.' };
  }

  const todos: TodoItem[] = [];
  for (let index = 0; index < todosValue.length; index += 1) {
    const raw = todosValue[index] as Record<string, unknown>;
    if (typeof raw?.content !== 'string' || raw.content.trim().length === 0) {
      return {
        error: `Invalid arguments: todo ${index + 1} is missing a non-empty "content".`,
      };
    }
    if (!isTodoStatus(raw.status)) {
      return {
        error:
          `Invalid arguments: todo ${index + 1} has an invalid "status" ` +
          `(expected one of ${STATUS_VALUES.join(', ')}).`,
      };
    }
    todos.push({ content: raw.content, status: raw.status });
  }

  const inProgress = todos.filter(
    (todo) => todo.status === 'in_progress'
  ).length;
  if (inProgress > 1) {
    return {
      error:
        `Invalid arguments: ${inProgress} todos are "in_progress" — keep at ` +
        'most one in progress at a time.',
    };
  }

  return { todos };
}

function isTodoStatus(value: unknown): value is TodoStatus {
  return (
    typeof value === 'string' &&
    (STATUS_VALUES as readonly string[]).includes(value)
  );
}
