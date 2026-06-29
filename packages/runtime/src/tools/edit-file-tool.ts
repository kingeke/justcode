import type { WorkspaceFilePort } from '@core/ports/workspace-file-port';
import type {
  Tool,
  ToolDefinition,
  ToolDiff,
  ToolExecutionContext,
  ToolInvocationView,
  ToolResult,
} from '@core/ports/tool';

interface EditFileArguments {
  path: string;
  oldString: string;
  newString: string;
  replaceAll: boolean;
  startLine?: number | undefined;
  endLine?: number | undefined;
}

/** How many matches to enumerate in an ambiguous-match error. */
const MAX_LISTED_MATCHES = 10;
/** Truncate context lines so the error stays readable. */
const MAX_CONTEXT_LENGTH = 100;

/**
 * Edits a file in place by replacing an exact occurrence of `old_string` with
 * `new_string`. By default the match must be unique so an edit can never touch
 * more of the file than intended. When the same text repeats, the match can be
 * disambiguated three ways: include more surrounding context in `old_string`,
 * scope the search to a `start_line`/`end_line` window, or pass `replace_all`.
 * Path-safety is enforced by the underlying `WorkspaceFilePort`.
 */
export class EditFileTool implements Tool {
  public readonly requiresApproval = true;

  public readonly definition: ToolDefinition = {
    name: 'edit_file',
    description:
      'Replace an exact string in an existing workspace file. The path is ' +
      'relative to the workspace root. "old_string" must match the file ' +
      'exactly (including whitespace). Unless "replace_all" is true, the match ' +
      'must be unique; if the text repeats, either add surrounding lines to ' +
      'old_string or scope the edit with "start_line"/"end_line" (1-based, ' +
      'inclusive — the line numbers shown by read_file). To create a new file ' +
      'use write_file instead.',
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
            'Replace every occurrence (within the line window if given) ' +
            'instead of requiring a unique match. Defaults to false.',
        },
        start_line: {
          type: 'number',
          description:
            'Optional 1-based line number to start searching from (inclusive). ' +
            'Use with end_line to target a repeated string in one region.',
        },
        end_line: {
          type: 'number',
          description:
            'Optional 1-based line number to stop searching at (inclusive). ' +
            'Defaults to the end of the file.',
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
    const scope =
      parsed.startLine !== undefined || parsed.endLine !== undefined
        ? ` (lines ${parsed.startLine ?? 1}-${parsed.endLine ?? 'end'})`
        : '';
    return {
      title: `edit ${parsed.path}${scope}`,
      preview: `${parsed.oldString}\n→\n${parsed.newString}`,
      path: parsed.path,
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

    const { path, oldString, newString } = parsed;
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
        content:
          'Invalid arguments: "old_string" and "new_string" are identical.',
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

    const plan = planEdit(parsed, original);
    if ('error' in plan) {
      return { content: plan.error, isError: true };
    }

    try {
      await this.workspace.writeFile(path, plan.updated);
    } catch (error: unknown) {
      return {
        content: `Failed to write ${path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        isError: true,
      };
    }

    const noun = plan.count === 1 ? 'occurrence' : 'occurrences';
    return { content: `Edited ${path} (${plan.count} ${noun} replaced).` };
  }

  public async previewDiff(
    rawArguments: string,
    _context: ToolExecutionContext
  ): Promise<ToolDiff | undefined> {
    const parsed = tryParse(rawArguments);
    if (!parsed?.path) {
      return undefined;
    }
    if (
      parsed.oldString.length === 0 ||
      parsed.oldString === parsed.newString
    ) {
      return undefined;
    }

    let original: string;
    try {
      original = await this.workspace.readFile(parsed.path);
    } catch {
      return undefined;
    }

    const plan = planEdit(parsed, original);
    if ('error' in plan) {
      return undefined;
    }
    return { path: parsed.path, oldText: original, newText: plan.updated };
  }
}

type EditPlan = { updated: string; count: number } | { error: string };

/** Pure core of an edit: resolve the window, find matches, build new content. */
function planEdit(parsed: EditFileArguments, original: string): EditPlan {
  const { path, oldString, newString, replaceAll, startLine, endLine } = parsed;
  const lineStarts = getLineStarts(original);
  const lineCount = lineStarts.length;

  // Resolve the search window (defaults to the whole file).
  const window = resolveWindow(
    startLine,
    endLine,
    lineCount,
    lineStarts,
    original
  );
  if ('error' in window) {
    return { error: `${window.error} (${path} has ${lineCount} lines).` };
  }

  const matches = findMatches(original, oldString, window.from, window.to);
  const where = describeWindow(startLine, endLine);
  if (matches.length === 0) {
    return { error: `No match for "old_string" in ${path}${where}.` };
  }
  if (matches.length > 1 && !replaceAll) {
    return {
      error: ambiguousMessage(path, oldString, matches, original, where),
    };
  }

  const updated = applyReplacements(original, oldString, newString, matches);
  return { updated, count: matches.length };
}

/** Character offset at which each 1-based line begins. */
function getLineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\n') {
      starts.push(index + 1);
    }
  }
  return starts;
}

type Window = { from: number; to: number } | { error: string };

function resolveWindow(
  startLine: number | undefined,
  endLine: number | undefined,
  lineCount: number,
  lineStarts: number[],
  content: string
): Window {
  if (startLine === undefined && endLine === undefined) {
    return { from: 0, to: content.length };
  }

  const start = startLine ?? 1;
  const end = endLine ?? lineCount;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end < 1
  ) {
    return {
      error: 'Invalid arguments: line numbers must be positive integers',
    };
  }
  if (start > end) {
    return {
      error: `Invalid arguments: start_line ${start} is after end_line ${end}`,
    };
  }
  if (start > lineCount) {
    return {
      error: `Invalid arguments: start_line ${start} is past the end of the file`,
    };
  }

  const from = lineStarts[start - 1] ?? 0;
  // Include the full text of `end` (up to, but not including, the next line).
  const to =
    end < lineCount ? (lineStarts[end] ?? content.length) : content.length;
  return { from, to };
}

/** Absolute offsets of every full occurrence of `needle` within [from, to). */
function findMatches(
  content: string,
  needle: string,
  from: number,
  to: number
): number[] {
  const indices: number[] = [];
  let index = content.indexOf(needle, from);
  while (index !== -1 && index + needle.length <= to) {
    indices.push(index);
    index = content.indexOf(needle, index + needle.length);
  }
  return indices;
}

/** Replace each match, working back-to-front so earlier offsets stay valid. */
function applyReplacements(
  content: string,
  oldString: string,
  newString: string,
  matches: number[]
): string {
  let updated = content;
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const at = matches[index] ?? 0;
    updated =
      updated.slice(0, at) + newString + updated.slice(at + oldString.length);
  }
  return updated;
}

function describeWindow(
  startLine: number | undefined,
  endLine: number | undefined
): string {
  if (startLine === undefined && endLine === undefined) {
    return '';
  }
  return ` within lines ${startLine ?? 1}-${endLine ?? 'end'}`;
}

function ambiguousMessage(
  path: string,
  oldString: string,
  matches: number[],
  content: string,
  where: string
): string {
  const lines = content.split('\n');
  const shown = matches.slice(0, MAX_LISTED_MATCHES);
  const listing = shown
    .map((offset) => {
      const lineNo = lineNumberOf(content, offset);
      const current = truncate((lines[lineNo - 1] ?? '').trim());
      const previous = truncate((lines[lineNo - 2] ?? '').trim());
      const context = previous ? `${previous} / ${current}` : current;
      return `  line ${lineNo}: ${context}`;
    })
    .join('\n');
  const more =
    matches.length > shown.length
      ? `\n  …and ${matches.length - shown.length} more`
      : '';

  return (
    `"${truncate(oldString)}" appears ${matches.length} times in ${path}${where}. ` +
    'Re-issue with a unique old_string (add surrounding lines), scope it with ' +
    'start_line/end_line, or pass replace_all=true. Matches:\n' +
    listing +
    more
  );
}

function lineNumberOf(content: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < content.length; index += 1) {
    if (content[index] === '\n') {
      line += 1;
    }
  }
  return line;
}

function truncate(text: string): string {
  return text.length > MAX_CONTEXT_LENGTH
    ? `${text.slice(0, MAX_CONTEXT_LENGTH)}…`
    : text;
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
      startLine:
        typeof parsed.start_line === 'number' ? parsed.start_line : undefined,
      endLine:
        typeof parsed.end_line === 'number' ? parsed.end_line : undefined,
    };
  } catch {
    return undefined;
  }
}
