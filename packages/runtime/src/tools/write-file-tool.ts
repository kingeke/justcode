import type { WorkspaceFilePort } from '@core/ports/workspace-file-port';
import type {
  Tool,
  ToolDefinition,
  ToolDiff,
  ToolExecutionContext,
  ToolInvocationView,
  ToolResult,
} from '@core/ports/tool';

interface WriteFileArguments {
  path: string;
  content: string;
}

/**
 * Writes a file inside the workspace. Path-safety (no escaping the workspace
 * root) is enforced by the underlying `WorkspaceFilePort`.
 */
export class WriteFileTool implements Tool {
  public readonly requiresApproval = true;

  public readonly definition: ToolDefinition = {
    name: 'write_file',
    description:
      'Create or overwrite a file in the workspace with the given content. ' +
      'The path is relative to the workspace root; parent directories are ' +
      'created automatically.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative path of the file to write.',
        },
        content: {
          type: 'string',
          description: 'Full contents to write to the file.',
        },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  };

  public constructor(private readonly workspace: WorkspaceFilePort) {}

  public describe(rawArguments: string): ToolInvocationView {
    const parsed = tryParse(rawArguments);
    if (!parsed) {
      return { title: 'write_file (unparseable arguments)' };
    }
    return { title: `write ${parsed.path}`, preview: parsed.content };
  }

  public async previewDiff(
    rawArguments: string,
    _context: ToolExecutionContext
  ): Promise<ToolDiff | undefined> {
    const parsed = tryParse(rawArguments);
    if (!parsed?.path) {
      return undefined;
    }
    // Diff against the existing file when overwriting; an empty `oldText`
    // signals a creation (the whole file reads as additions).
    let oldText = '';
    try {
      oldText = await this.workspace.readFile(parsed.path);
    } catch {
      oldText = '';
    }
    if (oldText === parsed.content) {
      return undefined;
    }
    return { path: parsed.path, oldText, newText: parsed.content };
  }

  public async execute(
    rawArguments: string,
    _context?: ToolExecutionContext
  ): Promise<ToolResult> {
    const parsed = tryParse(rawArguments);
    if (!parsed) {
      return {
        content: 'Invalid arguments: expected JSON with "path" and "content".',
        isError: true,
      };
    }

    const { path, content } = parsed;
    if (!path) {
      return {
        content: 'Invalid arguments: "path" is required.',
        isError: true,
      };
    }

    try {
      await this.workspace.writeFile(path, content);
    } catch (error: unknown) {
      return {
        content: `Failed to write ${path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        isError: true,
      };
    }

    const lineCount = content.length === 0 ? 0 : content.split('\n').length;
    return { content: `Wrote ${path} (${lineCount} lines).` };
  }
}

function tryParse(rawArguments: string): WriteFileArguments | undefined {
  try {
    const parsed = JSON.parse(rawArguments) as Partial<WriteFileArguments>;
    if (typeof parsed.path !== 'string') {
      return undefined;
    }
    return { path: parsed.path, content: parsed.content ?? '' };
  } catch {
    return undefined;
  }
}
