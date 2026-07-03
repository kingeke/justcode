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
import {
  extractSymbolBlock,
  listFileSymbols,
} from '@core/application/symbol-extraction';

// Re-exported from core so the read_file tool and @-mention attachments share a
// single default; the runtime still overrides it from user config.
export { DEFAULT_MAX_READ_LINES } from '@core/application/read-window';

/** How many candidate symbol names to suggest when a method isn't found. */
const MAX_SUGGESTED_SYMBOLS = 30;

interface ReadFileArguments {
  path: string;
  offset: number;
  limit?: number;
  /** When set, read only this method/symbol's block instead of the whole file. */
  method?: string;
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
  public readonly requiresApproval = true;

  public readonly definition: ToolDefinition = {
    name: 'read_file',
    description:
      'Read a file in the workspace as numbered lines. The path is relative ' +
      'to the workspace root. Use "offset" (1-based line number, default 1) ' +
      'and "limit" (maximum lines to return) to page through large files; the ' +
      'result reports the line range shown, the total line count, and whether ' +
      'more lines remain (pass the next offset to continue). Pass "method" to ' +
      "read just a single method/function/symbol's block (with the file's " +
      'real line numbers) instead of the whole file; if the method is not ' +
      'found, the result lists the symbols declared in the file. Symbol ' +
      'detection is heuristic — omit "method" to read the file if a symbol ' +
      `can't be located. Lines longer than ${MAX_LINE_LENGTH} characters are ` +
      'truncated and flagged.',
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
            'first line). Use the offset reported by a previous read to ' +
            'continue. When "method" is set, this is the 1-based line within ' +
            "the method (an absolute file line inside the method's range is " +
            'also accepted).',
        },
        limit: {
          type: 'number',
          description:
            'Maximum number of lines to return. Defaults to (and is capped at) ' +
            'the configured read limit.',
        },
        method: {
          type: 'string',
          description:
            'Optional. Name of a method/function/symbol to read instead of the ' +
            'whole file (e.g. "findMultipleBoq").',
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
    if (parsed.method) {
      return {
        title: `read ${parsed.path}::${parsed.method}`,
        path: parsed.path,
      };
    }
    const suffix = parsed.offset > 1 ? ` (from line ${parsed.offset})` : '';
    return { title: `read ${parsed.path}${suffix}`, path: parsed.path };
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
      return {
        content: 'Invalid arguments: "path" is required.',
        isError: true,
      };
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

    if (parsed.method) {
      return this.readMethod(path, text, parsed.method, offset, limit);
    }

    const lines = splitLines(text);
    const totalLines = lines.length;
    if (totalLines === 0) {
      return { content: `${path} is empty.` };
    }
    const maxLines = Math.max(1, Math.floor(this.getMaxLines()));
    const requested =
      limit !== undefined ? Math.min(limit, maxLines) : maxLines;
    let clampNote = '';
    let lineStart = offset;
    if (offset > totalLines) {
      // Clamp to the file's tail instead of erroring: returning data with a
      // note saves the model a corrective round-trip.
      lineStart = Math.max(1, totalLines - requested + 1);
      clampNote =
        `(note: offset ${offset} is past the end of ${path} — ` +
        `${totalLines} lines; showing the end of the file instead)\n`;
    }
    const lineEnd = Math.min(lineStart + requested - 1, totalLines);
    const truncated = lineEnd < totalLines;

    const body = lines
      .slice(lineStart - 1, lineEnd)
      .map((line, index) => formatNumberedLine(lineStart + index, line))
      .join('\n');

    const header = `${clampNote}${path} lines ${lineStart}-${lineEnd} of ${totalLines}`;
    if (!truncated) {
      return { content: `${header}\n${body}` };
    }

    const remaining = totalLines - lineEnd;
    const footer =
      `\n\n(truncated: ${remaining} more line${remaining === 1 ? '' : 's'}; ` +
      `use offset=${lineEnd + 1} to continue)`;
    return { content: `${header}\n${body}${footer}` };
  }

  /**
   * Reads a single method/symbol block. `offset` is 1-based within the method;
   * displayed line numbers stay aligned to the original file. On a miss, lists
   * the file's symbols so the model can retry.
   */
  private readMethod(
    path: string,
    text: string,
    method: string,
    offset: number,
    limit: number | undefined
  ): ToolResult {
    const block = extractSymbolBlock(text, method);
    if (!block) {
      const symbols = listFileSymbols(text);
      const suggestion = symbols.length
        ? ` Symbols found in this file: ${formatSymbolList(symbols)}.`
        : ' No symbols were detected in this file.';
      return {
        content: `Method '${method}' was not found in ${path}.${suggestion} Omit "method" to read the whole file.`,
        isError: true,
      };
    }

    const blockLength = block.lines.length;
    const blockEndLine = block.startLine + blockLength - 1;
    const maxLines = Math.max(1, Math.floor(this.getMaxLines()));
    const requested =
      limit !== undefined ? Math.min(limit, maxLines) : maxLines;
    let effectiveOffset = offset;
    let clampNote = '';
    if (offset > blockLength) {
      // The tool displays absolute file line numbers, so models routinely pass
      // one of those back as the offset even though it's documented as
      // method-relative. When the offset can't be relative but lands inside
      // the method's file-line range, honor it as an absolute line.
      if (offset >= block.startLine && offset <= blockEndLine) {
        effectiveOffset = offset - block.startLine + 1;
      } else {
        // Past the method in every interpretation: clamp to the method's tail
        // and return data with a note, rather than erroring — a dead end just
        // costs the model another round-trip to ask again.
        effectiveOffset = Math.max(1, blockLength - requested + 1);
        clampNote =
          `(note: offset ${offset} is past ${path}::${method}, which is ` +
          `${blockLength} lines at file lines ${block.startLine}-${blockEndLine}; ` +
          `showing the end of the method instead)\n`;
      }
    }
    const sliceStart = effectiveOffset - 1;
    const sliceEnd = Math.min(sliceStart + requested, blockLength);
    const firstFileLine = block.startLine + sliceStart;
    const truncated = sliceEnd < blockLength;

    const body = block.lines
      .slice(sliceStart, sliceEnd)
      .map((line, index) => formatNumberedLine(firstFileLine + index, line))
      .join('\n');

    const lastFileLine = block.startLine + sliceEnd - 1;
    const header = `${clampNote}${path}::${method} lines ${firstFileLine}-${lastFileLine} of ${block.startLine}-${blockEndLine}`;
    if (!truncated) {
      return { content: `${header}\n${body}` };
    }

    const remaining = blockLength - sliceEnd;
    const footer =
      `\n\n(truncated: ${remaining} more line${remaining === 1 ? '' : 's'} in ` +
      `this method; use offset=${sliceEnd + 1} to continue)`;
    return { content: `${header}\n${body}${footer}` };
  }
}

function formatSymbolList(symbols: string[]): string {
  const shown = symbols.slice(0, MAX_SUGGESTED_SYMBOLS);
  const suffix =
    symbols.length > shown.length
      ? `, … (+${symbols.length - shown.length} more)`
      : '';
  return shown.join(', ') + suffix;
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

    const method =
      typeof parsed.method === 'string' && parsed.method.trim()
        ? parsed.method.trim()
        : undefined;

    return {
      path: parsed.path,
      offset,
      ...(limit !== undefined ? { limit } : {}),
      ...(method !== undefined ? { method } : {}),
    };
  } catch {
    return undefined;
  }
}
