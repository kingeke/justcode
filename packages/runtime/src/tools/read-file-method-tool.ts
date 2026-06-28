import type { WorkspaceFilePort } from '@core/ports/workspace-file-port';
import type {
  Tool,
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocationView,
  ToolResult,
} from '@core/ports/tool';
import { MAX_LINE_LENGTH, formatNumberedLine } from '@core/application/read-window';
import {
  extractSymbolBlock,
  listFileSymbols,
} from '@core/application/symbol-extraction';

interface ReadFileMethodArguments {
  path: string;
  method: string;
  offset: number;
  limit?: number;
}

/** How many candidate symbol names to suggest when the method isn't found. */
const MAX_SUGGESTED_SYMBOLS = 30;

/**
 * Reads a single method/symbol from a workspace file as numbered lines, instead
 * of the whole file. It locates the named symbol's declaration and returns its
 * block (the `{ … }` body, or a body-less declaration up to its `;`), preserving
 * the file's real line numbers so references line up with `read_file`/`edit`.
 * `offset`/`limit` page within the method block for long methods. When the
 * method isn't found, the result lists the symbols that are declared in the file
 * so the model can retry with a valid name. Symbol detection is a textual
 * heuristic, so fall back to `read_file` if a method can't be located.
 */
export class ReadFileMethodTool implements Tool {
  public readonly requiresApproval = false;

  public readonly definition: ToolDefinition = {
    name: 'read_file_method',
    description:
      'Read a single method/function/symbol from a workspace file as numbered ' +
      'lines, rather than the whole file. Give the workspace-relative "path" ' +
      'and the "method" (symbol) name; the tool returns just that symbol\'s ' +
      'block with the file\'s real line numbers. Use "offset" (1-based line ' +
      'within the method, default 1) and "limit" to page through a long ' +
      'method. If the method is not found, the result lists the symbols ' +
      'declared in the file. Symbol detection is heuristic — fall back to ' +
      `read_file when needed. Lines longer than ${MAX_LINE_LENGTH} characters ` +
      'are truncated and flagged.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative path of the file to read.',
        },
        method: {
          type: 'string',
          description:
            'Name of the method/function/symbol to extract (e.g. ' +
            '"findMultipleBoq").',
        },
        offset: {
          type: 'number',
          description:
            '1-based line number within the method to start from. Defaults to ' +
            '1 (the method\'s first line).',
        },
        limit: {
          type: 'number',
          description:
            'Maximum number of lines to return. Defaults to (and is capped ' +
            'at) the configured read limit.',
        },
      },
      required: ['path', 'method'],
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
      return { title: 'read_file_method (unparseable arguments)' };
    }
    return { title: `read ${parsed.path}::${parsed.method}` };
  }

  public async execute(
    rawArguments: string,
    _context?: ToolExecutionContext
  ): Promise<ToolResult> {
    const parsed = tryParse(rawArguments);
    if (!parsed) {
      return {
        content:
          'Invalid arguments: expected JSON with "path" and "method" strings.',
        isError: true,
      };
    }

    const { path, method, offset, limit } = parsed;
    if (!path || !method) {
      return {
        content: 'Invalid arguments: "path" and "method" are required.',
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

    const block = extractSymbolBlock(text, method);
    if (!block) {
      const symbols = listFileSymbols(text);
      const suggestion = symbols.length
        ? ` Symbols found in this file: ${formatSymbolList(symbols)}.`
        : ' No symbols were detected in this file.';
      return {
        content: `Method '${method}' was not found in ${path}.${suggestion} Use read_file to read the whole file.`,
        isError: true,
      };
    }

    const blockLength = block.lines.length;
    if (offset > blockLength) {
      return {
        content: `Offset ${offset} is past the end of ${path}::${method} (${blockLength} lines).`,
        isError: true,
      };
    }

    const maxLines = Math.max(1, Math.floor(this.getMaxLines()));
    const requested =
      limit !== undefined ? Math.min(limit, maxLines) : maxLines;
    // `offset` is 1-based within the method; map it onto absolute file lines so
    // the displayed numbers match the rest of the file.
    const sliceStart = offset - 1;
    const sliceEnd = Math.min(sliceStart + requested, blockLength);
    const firstFileLine = block.startLine + sliceStart;
    const truncated = sliceEnd < blockLength;

    const body = block.lines
      .slice(sliceStart, sliceEnd)
      .map((line, index) => formatNumberedLine(firstFileLine + index, line))
      .join('\n');

    const lastFileLine = block.startLine + sliceEnd - 1;
    const header = `${path}::${method} lines ${firstFileLine}-${lastFileLine} of ${block.startLine}-${block.startLine + blockLength - 1}`;
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

function tryParse(rawArguments: string): ReadFileMethodArguments | undefined {
  try {
    const parsed = JSON.parse(rawArguments) as Partial<ReadFileMethodArguments>;
    if (typeof parsed.path !== 'string' || typeof parsed.method !== 'string') {
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

    return {
      path: parsed.path,
      method: parsed.method,
      offset,
      ...(limit !== undefined ? { limit } : {}),
    };
  } catch {
    return undefined;
  }
}
