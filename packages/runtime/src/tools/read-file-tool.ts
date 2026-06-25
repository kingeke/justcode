import type { WorkspaceFilePort } from '@core/ports/workspace-file-port';
import type {
  Tool,
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocationView,
  ToolResult,
} from '@core/ports/tool';
import {
  MAX_LINE_LENGTH,
  formatNumberedLine,
  splitLines,
} from '@core/application/read-window';

// Re-exported from core so the read_file tool and @-mention attachments share a
// single default; the runtime still overrides it from user config.
export { DEFAULT_MAX_READ_LINES } from '@core/application/read-window';

interface ReadFileArguments {
  path: string;
  offset: number;
  limit?: number;
}

/**
 * Reads a file inside the workspace as numbered lines, paging by line so a
 * single read can never flood the model's context. `offset` is a 1-based line
 * number and `limit` caps how many lines come back; when more lines remain the
 * result reports the line range, total line count, and the offset to continue
 * from. Individual lines longer than `MAX_LINE_LENGTH` are truncated and
 * flagged. Path-safety is enforced by the underlying `WorkspaceFilePort`.
 */
export class ReadFileTool implements Tool {
  public readonly requiresApproval = false;

  public readonly definition: ToolDefinition = {
    name: 'read_file',
    description:
      'Read a file in the workspace as numbered lines. The path is relative ' +
      'to the workspace root. Use "offset" (1-based line number, default 1) ' +
      'and "limit" (maximum lines to return) to page through large files; the ' +
      'result reports the line range shown, the total line count, and whether ' +
      'more lines remain (pass the next offset to continue). Lines longer than ' +
      `${MAX_LINE_LENGTH} characters are truncated and flagged.`,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative path of the file to read.',
        },
        offset: {
          type: 'number',
          description:
            '1-based line number to start reading from. Defaults to 1 (the ' +
            'first line). Use the offset reported by a previous read to continue.',
        },
        limit: {
          type: 'number',
          description:
            'Maximum number of lines to return. Defaults to (and is capped at) ' +
            'the configured read limit.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  };

  public constructor(
    private readonly workspace: WorkspaceFilePort,
    private readonly getMaxLines: () => number
  ) {}

  public describe(rawArguments: string): ToolInvocationView {
    const parsed = tryParse(rawArguments);
    if (!parsed) {
      return { title: 'read_file (unparseable arguments)' };
    }
    const suffix = parsed.offset > 1 ? ` (from line ${parsed.offset})` : '';
    return { title: `read ${parsed.path}${suffix}` };
  }

  public async execute(
    rawArguments: string,
    _context?: ToolExecutionContext
  ): Promise<ToolResult> {
    const parsed = tryParse(rawArguments);
    if (!parsed) {
      return {
        content: 'Invalid arguments: expected JSON with a "path" string.',
        isError: true,
      };
    }

    const { path, offset, limit } = parsed;
    if (!path) {
      return { content: 'Invalid arguments: "path" is required.', isError: true };
    }

    let text: string;
    try {
      text = await this.workspace.readFile(path);
    } catch (error: unknown) {
      return {
        content: `Failed to read ${path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        isError: true,
      };
    }

    const lines = splitLines(text);
    const totalLines = lines.length;
    if (totalLines === 0) {
      return { content: `${path} is empty.` };
    }
    if (offset > totalLines) {
      return {
        content: `Offset ${offset} is past the end of ${path} (${totalLines} lines).`,
        isError: true,
      };
    }

    const maxLines = Math.max(1, Math.floor(this.getMaxLines()));
    const requested = limit !== undefined ? Math.min(limit, maxLines) : maxLines;
    const lineStart = offset;
    const lineEnd = Math.min(offset + requested - 1, totalLines);
    const truncated = lineEnd < totalLines;

    const body = lines
      .slice(lineStart - 1, lineEnd)
      .map((line, index) => formatNumberedLine(lineStart + index, line))
      .join('\n');

    const header = `${path} lines ${lineStart}-${lineEnd} of ${totalLines}`;
    if (!truncated) {
      return { content: `${header}\n${body}` };
    }

    const remaining = totalLines - lineEnd;
    const footer =
      `\n\n(truncated: ${remaining} more line${remaining === 1 ? '' : 's'}; ` +
      `use offset=${lineEnd + 1} to continue)`;
    return { content: `${header}\n${body}${footer}` };
  }
}

function tryParse(rawArguments: string): ReadFileArguments | undefined {
  try {
    const parsed = JSON.parse(rawArguments) as Partial<ReadFileArguments>;
    if (typeof parsed.path !== 'string') {
      return undefined;
    }

    const rawOffset = typeof parsed.offset === 'number' ? parsed.offset : 1;
    const offset = Number.isFinite(rawOffset)
      ? Math.max(1, Math.floor(rawOffset))
      : 1;

    let limit: number | undefined;
    if (typeof parsed.limit === 'number' && Number.isFinite(parsed.limit)) {
      limit = Math.max(1, Math.floor(parsed.limit));
    }

    return { path: parsed.path, offset, ...(limit !== undefined ? { limit } : {}) };
  } catch {
    return undefined;
  }
}
