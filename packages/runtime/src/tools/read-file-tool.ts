import type { WorkspaceFilePort } from '@core/ports/workspace-file-port';
import type {
  Tool,
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocationView,
  ToolResult,
} from '@core/ports/tool';

/** Default window size if the user hasn't configured one. */
export const DEFAULT_MAX_READ_BYTES = 50 * 1024;

interface ReadFileArguments {
  path: string;
  offset: number;
}

/**
 * Reads a file inside the workspace in fixed-size windows so a single read can
 * never flood the model's context. Windowing is by byte offset (not line) so it
 * stays bounded even for files with very long lines. When the file is larger
 * than the window, the result tells the model the byte offset to pass back in to
 * continue reading. Path-safety is enforced by the underlying `WorkspaceFilePort`.
 */
export class ReadFileTool implements Tool {
  public readonly requiresApproval = false;

  public readonly definition: ToolDefinition = {
    name: 'read_file',
    description:
      'Read a file in the workspace. The path is relative to the workspace ' +
      'root. Output is capped at a fixed size; if the file is larger, pass the ' +
      '"offset" reported in the result to continue reading from where you left ' +
      'off. Lines are prefixed with their line number.',
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
            'Byte offset to start reading from. Defaults to 0 (the start of ' +
            'the file). Use the offset reported by a previous read to continue.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  };

  public constructor(
    private readonly workspace: WorkspaceFilePort,
    private readonly getMaxBytes: () => number
  ) {}

  public describe(rawArguments: string): ToolInvocationView {
    const parsed = tryParse(rawArguments);
    if (!parsed) {
      return { title: 'read_file (unparseable arguments)' };
    }
    const suffix = parsed.offset > 0 ? ` (from byte ${parsed.offset})` : '';
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

    const { path, offset } = parsed;
    if (!path) {
      return {
        content: 'Invalid arguments: "path" is required.',
        isError: true,
      };
    }

    let bytes: Uint8Array;
    try {
      bytes = await this.workspace.readFileBytes(path);
    } catch (error: unknown) {
      return {
        content: `Failed to read ${path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        isError: true,
      };
    }

    const total = bytes.length;
    if (total === 0) {
      return { content: `${path} is empty.` };
    }
    if (offset >= total) {
      return {
        content: `Offset ${offset} is at or past the end of ${path} (${total} bytes).`,
        isError: true,
      };
    }

    const maxBytes = Math.max(1, Math.floor(this.getMaxBytes()));
    const buffer = Buffer.from(bytes);
    const end = Math.min(offset + maxBytes, total);
    const startLine = countNewlines(buffer.subarray(0, offset)) + 1;
    const text = buffer.subarray(offset, end).toString('utf8');

    const body = numberLines(text, startLine);
    if (end >= total) {
      return { content: body };
    }

    const shownKb = Math.round((end - offset) / 1024);
    const note =
      `\n\n(Output capped at ${shownKb} KB. Showing bytes ${offset}-${end} of ` +
      `${total}. Use offset=${end} to continue reading.)`;
    return { content: body + note };
  }
}

function numberLines(text: string, startLine: number): string {
  const lines = text.split('\n');
  return lines.map((line, index) => `${startLine + index}\t${line}`).join('\n');
}

function countNewlines(buffer: Buffer): number {
  let count = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === 0x0a) count += 1;
  }
  return count;
}

function tryParse(rawArguments: string): ReadFileArguments | undefined {
  try {
    const parsed = JSON.parse(rawArguments) as Partial<ReadFileArguments>;
    if (typeof parsed.path !== 'string') {
      return undefined;
    }
    const rawOffset = typeof parsed.offset === 'number' ? parsed.offset : 0;
    const offset = Number.isFinite(rawOffset)
      ? Math.max(0, Math.floor(rawOffset))
      : 0;
    return { path: parsed.path, offset };
  } catch {
    return undefined;
  }
}
