import { spawn } from 'node:child_process';

import type {
  Tool,
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocationView,
  ToolResult,
} from '@core/ports/tool';

interface BashArguments {
  command: string;
  timeout?: number;
}

/** Default time a command may run before it is killed. */
export const DEFAULT_BASH_TIMEOUT_MS = 120_000;
/** Hard ceiling on the requested timeout, regardless of what the model asks. */
export const MAX_BASH_TIMEOUT_MS = 600_000;
/**
 * Combined stdout+stderr cap. Output beyond this is dropped (head kept) so a
 * runaway command can't flood the model's context.
 */
export const MAX_BASH_OUTPUT_CHARS = 2_000;

/**
 * Runs a shell command in the workspace root and returns its combined output
 * and exit code. The command runs through the system shell so pipes,
 * redirection, and `&&` work as written. Because arbitrary commands can mutate
 * the system, every invocation requires approval. The call is bounded by a
 * timeout and honors the context's `AbortSignal` (e.g. when the user cancels).
 */
export class BashTool implements Tool {
  public readonly requiresApproval = true;

  public readonly definition: ToolDefinition = {
    name: 'bash',
    description:
      'Execute a shell command in the workspace root and return its combined ' +
      'stdout and stderr along with the exit code. The command runs through ' +
      'the system shell, so pipes, redirection, globbing, and `&&`/`||` work. ' +
      'Provide an optional "timeout" in milliseconds (default ' +
      `${DEFAULT_BASH_TIMEOUT_MS}, max ${MAX_BASH_TIMEOUT_MS}); the command is ` +
      'killed if it runs longer. Output is truncated when very large.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute.',
        },
        timeout: {
          type: 'number',
          description:
            'Maximum time in milliseconds to allow the command to run before ' +
            `it is killed. Defaults to ${DEFAULT_BASH_TIMEOUT_MS} and is ` +
            `capped at ${MAX_BASH_TIMEOUT_MS}.`,
        },
      },
      required: ['command'],
      additionalProperties: false,
    },
  };

  public describe(rawArguments: string): ToolInvocationView {
    const parsed = tryParse(rawArguments);
    if (!parsed) {
      return { title: 'bash (unparseable arguments)' };
    }
    const firstLine = parsed.command.split('\n', 1)[0] ?? '';
    const title =
      firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
    return { title: `bash: ${title}`, preview: parsed.command };
  }

  public async execute(
    rawArguments: string,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const parsed = tryParse(rawArguments);
    if (!parsed) {
      return {
        content: 'Invalid arguments: expected JSON with a "command" string.',
        isError: true,
      };
    }
    if (!parsed.command.trim()) {
      return {
        content: 'Invalid arguments: "command" is required.',
        isError: true,
      };
    }

    return this.run(
      parsed.command,
      parsed.timeout ?? DEFAULT_BASH_TIMEOUT_MS,
      context
    );
  }

  private run(
    command: string,
    timeoutMs: number,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    return new Promise<ToolResult>((resolve) => {
      const child = spawn(command, {
        shell: true,
        cwd: context.workspaceRoot,
      });

      let output = '';
      let truncated = false;
      const collect = (chunk: Buffer): void => {
        if (truncated) {
          return;
        }
        output += chunk.toString('utf8');
        if (output.length > MAX_BASH_OUTPUT_CHARS) {
          output = output.slice(0, MAX_BASH_OUTPUT_CHARS);
          truncated = true;
        }
      };
      child.stdout?.on('data', collect);
      child.stderr?.on('data', collect);

      // `killed` distinguishes a timeout/abort from an ordinary non-zero exit.
      let killReason: 'timeout' | 'aborted' | undefined;
      const timer = setTimeout(() => {
        killReason = 'timeout';
        child.kill('SIGTERM');
      }, timeoutMs);

      const onAbort = (): void => {
        killReason = 'aborted';
        child.kill('SIGTERM');
      };
      context.signal?.addEventListener('abort', onAbort, { once: true });
      if (context.signal?.aborted) {
        onAbort();
      }

      const cleanup = (): void => {
        clearTimeout(timer);
        context.signal?.removeEventListener('abort', onAbort);
      };

      child.on('error', (error: Error) => {
        cleanup();
        resolve({
          content: `Failed to run command: ${error.message}`,
          isError: true,
        });
      });

      child.on('close', (code, signal) => {
        cleanup();
        resolve(this.format(output, truncated, code, signal, killReason));
      });
    });
  }

  private format(
    output: string,
    truncated: boolean,
    code: number | null,
    signal: NodeJS.Signals | null,
    killReason: 'timeout' | 'aborted' | undefined
  ): ToolResult {
    const body = output.length > 0 ? output : '(no output)';
    const note = truncated
      ? `\n\n(output truncated at ${MAX_BASH_OUTPUT_CHARS} characters)`
      : '';

    if (killReason === 'timeout') {
      return {
        content: `Command timed out and was killed.\n${body}${note}`,
        isError: true,
      };
    }
    if (killReason === 'aborted') {
      return {
        content: `Command was cancelled.\n${body}${note}`,
        isError: true,
      };
    }
    if (code === 0) {
      return { content: `${body}${note}` };
    }

    const status =
      code !== null ? `exit code ${code}` : `terminated by signal ${signal}`;
    return {
      content: `Command failed (${status}).\n${body}${note}`,
      isError: true,
    };
  }
}

function tryParse(rawArguments: string): BashArguments | undefined {
  try {
    const parsed = JSON.parse(rawArguments) as Partial<BashArguments>;
    if (typeof parsed.command !== 'string') {
      return undefined;
    }

    let timeout = DEFAULT_BASH_TIMEOUT_MS;
    if (typeof parsed.timeout === 'number' && Number.isFinite(parsed.timeout)) {
      timeout = Math.min(
        MAX_BASH_TIMEOUT_MS,
        Math.max(1, Math.floor(parsed.timeout))
      );
    }

    return { command: parsed.command, timeout };
  } catch {
    return undefined;
  }
}
