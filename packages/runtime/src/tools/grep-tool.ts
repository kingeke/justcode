import type { WorkspaceFilePort } from '@core/ports/workspace-file-port';
import type {
  Tool,
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocationView,
  ToolResult,
} from '@core/ports/tool';
import { splitLines } from '@core/application/read-window';

interface GrepArguments {
  pattern: string;
  path?: string;
  literal?: boolean;
  case_sensitive?: boolean;
  max_results?: number;
}

const DEFAULT_MAX_RESULTS = 50;
const MAX_LINE_LENGTH = 240;

/**
 * Searches workspace files for a text or regular-expression pattern and
 * returns matching lines with file names and line numbers. The tool is
 * read-only and does not require approval. A `path` value restricts the search
 * to a workspace-relative file or directory prefix.
 */
export class GrepTool implements Tool {
  public readonly requiresApproval = false;

  public readonly definition: ToolDefinition = {
    name: 'grep',
    description:
      'Search workspace files for a text or regular-expression pattern and ' +
      'return matching lines with file names and line numbers. Use "literal" ' +
      'to treat the pattern as plain text instead of a regex. Optionally pass ' +
      '"path" to restrict the search to a workspace-relative file or directory ' +
      'prefix. Results are capped to avoid flooding the context.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Text or regular expression to search for.',
        },
        path: {
          type: 'string',
          description:
            'Optional workspace-relative file or directory prefix to search within.',
        },
        literal: {
          type: 'boolean',
          description:
            'Treat pattern as a literal string instead of a regular expression. Defaults to false.',
        },
        case_sensitive: {
          type: 'boolean',
          description:
            'Match case when searching. Defaults to true for both literal and regex searches.',
        },
        max_results: {
          type: 'number',
          description:
            'Maximum number of matching lines to return. Defaults to 50 and is capped at 200.',
        },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
  };

  public constructor(private readonly workspace: WorkspaceFilePort) {}

  public describe(rawArguments: string): ToolInvocationView {
    const parsed = tryParse(rawArguments);
    if (!parsed) {
      return { title: 'grep (unparseable arguments)' };
    }

    const mode = parsed.literal ? 'literal' : 'regex';
    const scope = parsed.path ? ` in ${parsed.path}` : '';
    const flags = parsed.case_sensitive ? '' : ' (case-insensitive)';
    return {
      title: `grep ${mode}: ${truncate(parsed.pattern, 60)}${scope}${flags}`,
      preview: parsed.pattern,
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
          'Invalid arguments: expected JSON with a "pattern" string and optional "path".',
        isError: true,
      };
    }

    if (!parsed.pattern.trim()) {
      return {
        content: 'Invalid arguments: "pattern" is required.',
        isError: true,
      };
    }

    const regex = compilePattern(
      parsed.pattern,
      parsed.literal,
      parsed.case_sensitive
    );
    if (typeof regex === 'string') {
      return { content: regex, isError: true };
    }

    const files = await this.workspace.listFiles();
    const scopedFiles = parsed.path
      ? files.filter((file) => matchesPathFilter(file, parsed.path ?? ''))
      : files;

    if (scopedFiles.length === 0) {
      return {
        content: parsed.path
          ? `No files matched path prefix ${parsed.path}.`
          : 'No files found in the workspace.',
        isError: true,
      };
    }

    const maxResults = clampMaxResults(
      parsed.max_results ?? DEFAULT_MAX_RESULTS
    );
    const matches: string[] = [];
    let fileCount = 0;

    for (const file of scopedFiles) {
      let text: string;
      try {
        text = await this.workspace.readFile(file);
      } catch {
        continue;
      }

      const lines = splitLines(text);
      let fileMatched = false;
      for (let index = 0; index < lines.length; index += 1) {
        if (!regex.test(lines[index] ?? '')) {
          continue;
        }

        if (!fileMatched) {
          fileCount += 1;
          fileMatched = true;
        }

        matches.push(
          `${file}:${index + 1}: ${truncate(lines[index] ?? '', MAX_LINE_LENGTH)}`
        );
        if (matches.length >= maxResults) {
          return this.formatResult(
            matches,
            fileCount,
            true,
            maxResults,
            parsed
          );
        }
      }
    }

    return this.formatResult(matches, fileCount, false, maxResults, parsed);
  }

  private formatResult(
    matches: string[],
    fileCount: number,
    truncated: boolean,
    maxResults: number,
    parsed: Required<GrepArguments>
  ): ToolResult {
    if (matches.length === 0) {
      const scope = parsed.path ? ` in ${parsed.path}` : '';
      return {
        content: `No matches found for ${formatPattern(parsed)}${scope}.`,
      };
    }

    const header = `Found ${matches.length} matching line${
      matches.length === 1 ? '' : 's'
    } in ${fileCount} file${fileCount === 1 ? '' : 's'}.`;
    const note = truncated
      ? `\n\n(Results truncated at ${maxResults} matches.)`
      : '';

    return { content: `${header}\n${matches.join('\n')}${note}` };
  }
}

function tryParse(rawArguments: string): Required<GrepArguments> | undefined {
  try {
    const parsed = JSON.parse(rawArguments) as Partial<GrepArguments>;
    if (typeof parsed.pattern !== 'string') {
      return undefined;
    }

    const path = typeof parsed.path === 'string' ? parsed.path : '';
    const literal = parsed.literal === true;
    const caseSensitive = parsed.case_sensitive !== false;
    const rawMaxResults =
      typeof parsed.max_results === 'number' &&
      Number.isFinite(parsed.max_results)
        ? parsed.max_results
        : DEFAULT_MAX_RESULTS;

    return {
      pattern: parsed.pattern,
      path,
      literal,
      case_sensitive: caseSensitive,
      max_results: rawMaxResults,
    };
  } catch {
    return undefined;
  }
}

function compilePattern(
  pattern: string,
  literal: boolean,
  caseSensitive: boolean
): RegExp | string {
  try {
    const source = literal ? escapeRegExp(pattern) : pattern;
    return new RegExp(source, caseSensitive ? '' : 'i');
  } catch (error: unknown) {
    return `Invalid pattern: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function matchesPathFilter(file: string, path: string): boolean {
  const normalized = normalizeWorkspacePath(path);
  if (normalized.length === 0) {
    return true;
  }

  return file === normalized || file.startsWith(`${normalized}/`);
}

function normalizeWorkspacePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}

function clampMaxResults(value: number): number {
  return Math.max(1, Math.min(200, Math.floor(value)));
}

function formatPattern(parsed: Required<GrepArguments>): string {
  const pattern = parsed.literal
    ? JSON.stringify(parsed.pattern)
    : `/${parsed.pattern}/`;
  return parsed.case_sensitive ? pattern : `${pattern}i`;
}
