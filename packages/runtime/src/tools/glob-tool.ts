import type { WorkspaceFilePort } from '@core/ports/workspace-file-port';
import type {
  Tool,
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocationView,
  ToolResult,
} from '@core/ports/tool';

interface GlobArguments {
  pattern: string;
  path?: string;
  case_sensitive?: boolean;
  max_results?: number;
}

const DEFAULT_MAX_RESULTS = 100;

/**
 * Finds workspace files whose paths match a glob pattern and returns the
 * matching workspace-relative paths. The tool is read-only and does not require
 * approval. Supported glob syntax mirrors common shell globbing: `*` matches any
 * run of characters except `/`, `**` matches across directory boundaries, `?`
 * matches a single non-`/` character, and `{a,b}` matches any of the
 * comma-separated alternatives. A `path` value restricts the search to a
 * workspace-relative directory prefix.
 */
export class GlobTool implements Tool {
  public readonly requiresApproval = true;

  public readonly definition: ToolDefinition = {
    name: 'glob',
    description:
      'Find workspace files whose paths match a glob pattern and return the ' +
      'matching workspace-relative paths. Supports "*" (any characters except ' +
      '"/"), "**" (across directories), "?" (a single character), and ' +
      '"{a,b}" alternatives. Optionally pass "path" to restrict matching to a ' +
      'workspace-relative directory prefix. Results are capped to avoid ' +
      'flooding the context.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description:
            'Glob pattern to match against workspace-relative file paths, e.g. "src/**/*.ts".',
        },
        path: {
          type: 'string',
          description:
            'Optional workspace-relative directory prefix to search within.',
        },
        case_sensitive: {
          type: 'boolean',
          description: 'Match case when comparing paths. Defaults to true.',
        },
        max_results: {
          type: 'number',
          description:
            'Maximum number of matching paths to return. Defaults to 100 and is capped at 500.',
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
      return { title: 'glob (unparseable arguments)' };
    }

    const scope = parsed.path ? ` in ${parsed.path}` : '';
    const flags = parsed.case_sensitive ? '' : ' (case-insensitive)';
    return {
      title: `glob: ${truncate(parsed.pattern, 60)}${scope}${flags}`,
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

    const regex = compileGlob(parsed.pattern, parsed.case_sensitive);
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
      };
    }

    const prefix = normalizeWorkspacePath(parsed.path);
    const maxResults = clampMaxResults(
      parsed.max_results ?? DEFAULT_MAX_RESULTS
    );
    const matches: string[] = [];

    for (const file of scopedFiles) {
      // Match the pattern relative to the provided path prefix, so a pattern
      // like "**/*.ts" works the same with or without a scoping prefix.
      const candidate =
        prefix.length > 0 ? file.slice(prefix.length + 1) : file;
      if (!regex.test(candidate)) {
        continue;
      }

      matches.push(file);
      if (matches.length >= maxResults) {
        return formatResult(matches, true, maxResults, parsed);
      }
    }

    return formatResult(matches, false, maxResults, parsed);
  }
}

function formatResult(
  matches: string[],
  truncated: boolean,
  maxResults: number,
  parsed: Required<GlobArguments>
): ToolResult {
  if (matches.length === 0) {
    const scope = parsed.path ? ` in ${parsed.path}` : '';
    return {
      content: `No files matched ${parsed.pattern}${scope}.`,
    };
  }

  const header = `Found ${matches.length} file${
    matches.length === 1 ? '' : 's'
  }.`;
  const note = truncated
    ? `\n\n(Results truncated at ${maxResults} files.)`
    : '';

  return { content: `${header}\n${matches.join('\n')}${note}` };
}

function tryParse(rawArguments: string): Required<GlobArguments> | undefined {
  try {
    const parsed = JSON.parse(rawArguments) as Partial<GlobArguments>;
    if (typeof parsed.pattern !== 'string') {
      return undefined;
    }

    const path = typeof parsed.path === 'string' ? parsed.path : '';
    const caseSensitive = parsed.case_sensitive !== false;
    const rawMaxResults =
      typeof parsed.max_results === 'number' &&
      Number.isFinite(parsed.max_results)
        ? parsed.max_results
        : DEFAULT_MAX_RESULTS;

    return {
      pattern: parsed.pattern,
      path,
      case_sensitive: caseSensitive,
      max_results: rawMaxResults,
    };
  } catch {
    return undefined;
  }
}

function compileGlob(pattern: string, caseSensitive: boolean): RegExp | string {
  try {
    const normalized = normalizeWorkspacePath(pattern);
    const source = `^${globToRegExpSource(normalized)}$`;
    return new RegExp(source, caseSensitive ? '' : 'i');
  } catch (error: unknown) {
    return `Invalid pattern: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Translates a glob pattern into a regular-expression source string. Handles
 * `**`, `*`, `?`, `{a,b}` alternatives, and escapes all other regex
 * metacharacters so they match literally.
 */
function globToRegExpSource(pattern: string): string {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] ?? '';
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        // Consume the second star plus an optional trailing slash so that
        // "**/foo" also matches a top-level "foo".
        index += 1;
        if (pattern[index + 1] === '/') {
          index += 1;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else if (char === '{') {
      const closing = pattern.indexOf('}', index);
      if (closing === -1) {
        source += '\\{';
      } else {
        const alternatives = pattern
          .slice(index + 1, closing)
          .split(',')
          .map((alt) => globToRegExpSource(alt));
        source += `(?:${alternatives.join('|')})`;
        index = closing;
      }
    } else {
      source += escapeRegExp(char);
    }
  }

  return source;
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
  return Math.max(1, Math.min(500, Math.floor(value)));
}
