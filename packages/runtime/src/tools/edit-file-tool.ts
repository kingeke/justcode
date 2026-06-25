import type { WorkspaceFilePort } from '@core/ports/workspace-file-port';
import type {
  Tool,
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocationView,
  ToolResult,
} from '@core/ports/tool';

interface EditFileArguments {
  path: string;
  oldString: string;
  newString: string;
  replaceAll: boolean;
}

/**
 * Edits a file in place by replacing an exact occurrence of `old_string` with
 * `new_string`. By default the match must be unique so an edit can never touch
 * more of the file than intended; pass `replace_all` to rewrite every
 * occurrence. Path-safety is enforced by the underlying `WorkspaceFilePort`.
 */
export class EditFileTool implements Tool {
  public readonly requiresApproval = true;

  public readonly definition: ToolDefinition = {
    name: 'edit_file',
    description:
      'Replace an exact string in an existing workspace file. The path is ' +
      'relative to the workspace root. "old_string" must match the file ' +
      'exactly (including whitespace) and, unless "replace_all" is true, must ' +
      'appear exactly once. To create a new file use write_file instead.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative path of the file to edit.',
        },
        old_string: {
          type: 'string',
          description: 'The exact text to replace.',
        },
        new_string: {
          type: 'string',
          description: 'The text to replace it with.',
        },
        replace_all: {
          type: 'boolean',
          description:
            'Replace every occurrence instead of requiring a unique match. ' +
            'Defaults to false.',
        },
      },
      required: ['path', 'old_string', 'new_string'],
      additionalProperties: false,
    },
  };

  public constructor(private readonly workspace: WorkspaceFilePort) {}

  public describe(rawArguments: string): ToolInvocationView {
    const parsed = tryParse(rawArguments);
    if (!parsed) {
      return { title: 'edit_file (unparseable arguments)' };
    }
    return {
      title: `edit ${parsed.path}`,
      preview: `${parsed.oldString}\n→\n${parsed.newString}`,
    };
  }

  public async execute(
    rawArguments: string,
    _context?: ToolExecutionContext
  ): Promise<ToolResult> {
    const parsed = tryParse(rawArguments);
    if (!parsed) {
      return {
        content:
          'Invalid arguments: expected JSON with "path", "old_string", and ' +
          '"new_string".',
        isError: true,
      };
    }

    const { path, oldString, newString, replaceAll } = parsed;
    if (!path) {
      return {
        content: 'Invalid arguments: "path" is required.',
        isError: true,
      };
    }
    if (oldString.length === 0) {
      return {
        content:
          'Invalid arguments: "old_string" must not be empty. Use write_file ' +
          'to create a file.',
        isError: true,
      };
    }
    if (oldString === newString) {
      return {
        content: 'Invalid arguments: "old_string" and "new_string" are identical.',
        isError: true,
      };
    }

    let original: string;
    try {
      original = await this.workspace.readFile(path);
    } catch (error: unknown) {
      return {
        content: `Failed to read ${path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        isError: true,
      };
    }

    const occurrences = countOccurrences(original, oldString);
    if (occurrences === 0) {
      return {
        content: `No match for "old_string" in ${path}.`,
        isError: true,
      };
    }
    if (occurrences > 1 && !replaceAll) {
      return {
        content:
          `"old_string" appears ${occurrences} times in ${path}. Provide more ` +
          'surrounding context to make it unique, or pass replace_all=true.',
        isError: true,
      };
    }

    const updated = replaceAll
      ? original.split(oldString).join(newString)
      : original.replace(oldString, newString);

    try {
      await this.workspace.writeFile(path, updated);
    } catch (error: unknown) {
      return {
        content: `Failed to write ${path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        isError: true,
      };
    }

    const replaced = replaceAll ? occurrences : 1;
    const noun = replaced === 1 ? 'occurrence' : 'occurrences';
    return { content: `Edited ${path} (${replaced} ${noun} replaced).` };
  }
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function tryParse(rawArguments: string): EditFileArguments | undefined {
  try {
    const parsed = JSON.parse(rawArguments) as Record<string, unknown>;
    if (typeof parsed.path !== 'string') {
      return undefined;
    }
    if (
      typeof parsed.old_string !== 'string' ||
      typeof parsed.new_string !== 'string'
    ) {
      return undefined;
    }
    return {
      path: parsed.path,
      oldString: parsed.old_string,
      newString: parsed.new_string,
      replaceAll: parsed.replace_all === true,
    };
  } catch {
    return undefined;
  }
}
