import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';

import {
  DEFAULT_VIDEO_FRAME_COUNT,
  MAX_VIDEO_FRAME_COUNT,
  MAX_VIDEO_FRAME_WIDTH,
  clampVideoFrameCount,
  videoFrameTimestamps,
} from '@core/application/video-frames';
import { ImageMediaType } from '@core/domain/image-media-type';
import type { MessageImage } from '@core/domain/message';
import { ToolName } from '@core/domain/tool-name';
import type {
  Tool,
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocationView,
  ToolResult,
} from '@core/ports/tool';

// Re-exported so hosts can seed/clamp the configurable default without reaching
// into core.
export {
  DEFAULT_VIDEO_FRAME_COUNT,
  MAX_VIDEO_FRAME_COUNT,
  clampVideoFrameCount,
};

/** How long a single ffprobe/ffmpeg invocation may run before it is killed. */
const FFMPEG_TIMEOUT_MS = 60_000;

/** JPEG quality passed to ffmpeg (2 = best, 31 = worst) for extracted frames. */
const FRAME_JPEG_QUALITY = 4;

/** External binaries the tool shells out to, overridable for tests. */
export interface VideoToolBinaries {
  ffmpegPath?: string;
  ffprobePath?: string;
}

interface ReadVideoArguments {
  path: string;
  frames?: number;
  startSeconds?: number;
  endSeconds?: number;
}

/**
 * Reads a video by sampling it into still frames and handing those frames to
 * the model as images. Frames cost context, so the count defaults to the user's
 * configured value (see `DEFAULT_VIDEO_FRAME_COUNT`) and the model can raise it
 * — or narrow the time window — per call when it missed something. Frame
 * extraction shells out to the system `ffmpeg`/`ffprobe`.
 */
export class ReadVideoTool implements Tool {
  public readonly requiresApproval = true;

  public readonly definition: ToolDefinition = {
    name: ToolName.ReadVideo,
    description:
      'Read a video file in the workspace by sampling evenly spaced frames ' +
      'and returning them as images. The path is relative to the workspace ' +
      'root. Frames use context, so only as many as configured are sampled ' +
      'by default: pass "frames" to sample more (or fewer) when you need more ' +
      'detail, and "start_seconds"/"end_seconds" to zoom into a section of the ' +
      'video and sample it densely. The result reports the video duration and ' +
      `the timestamp of every frame returned. At most ${MAX_VIDEO_FRAME_COUNT} ` +
      'frames come back per call. Requires ffmpeg to be installed.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative path of the video file to read.',
        },
        frames: {
          type: 'number',
          description:
            'How many evenly spaced frames to sample. Defaults to the ' +
            'configured frame limit; capped at ' +
            `${MAX_VIDEO_FRAME_COUNT}. Raise it to capture detail you missed.`,
        },
        start_seconds: {
          type: 'number',
          description:
            'Start of the time window to sample, in seconds. Defaults to the ' +
            'start of the video.',
        },
        end_seconds: {
          type: 'number',
          description:
            'End of the time window to sample, in seconds. Defaults to the ' +
            'end of the video.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  };

  public constructor(
    private readonly getDefaultFrameCount: () => number,
    private readonly binaries: VideoToolBinaries = {}
  ) {}

  public describe(rawArguments: string): ToolInvocationView {
    const parsed = tryParse(rawArguments);
    if (!parsed) {
      return { title: `${ToolName.ReadVideo} (unparseable arguments)` };
    }
    const frames = clampVideoFrameCount(
      parsed.frames ?? this.getDefaultFrameCount()
    );
    return {
      title: `read video ${parsed.path} (${frames} frames)`,
      path: parsed.path,
    };
  }

  public async execute(
    rawArguments: string,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const parsed = tryParse(rawArguments);
    if (!parsed) {
      return {
        content: 'Invalid arguments: expected JSON with a "path" string.',
        isError: true,
      };
    }

    const absolutePath = resolveInsideWorkspace(
      context.workspaceRoot,
      parsed.path
    );
    if (!absolutePath) {
      return {
        content: `Path '${parsed.path}' is outside the workspace.`,
        isError: true,
      };
    }
    try {
      if (!statSync(absolutePath).isFile()) {
        return { content: `'${parsed.path}' is not a file.`, isError: true };
      }
    } catch {
      return { content: `File not found: ${parsed.path}`, isError: true };
    }

    const duration = await this.probeDuration(absolutePath, context);
    if (duration instanceof Error) {
      return { content: duration.message, isError: true };
    }

    const start = Math.max(0, parsed.startSeconds ?? 0);
    const end =
      parsed.endSeconds !== undefined && parsed.endSeconds > start
        ? Math.min(
            parsed.endSeconds,
            duration > 0 ? duration : parsed.endSeconds
          )
        : duration;
    const frameCount = clampVideoFrameCount(
      parsed.frames ?? this.getDefaultFrameCount()
    );
    const timestamps = videoFrameTimestamps(start, end, frameCount);

    const directory = mkdtempSync(join(tmpdir(), 'justcode-video-'));
    const images: MessageImage[] = [];
    const captured: number[] = [];
    try {
      for (const [index, timestamp] of timestamps.entries()) {
        const outputPath = join(directory, `frame-${index}.jpg`);
        const extracted = await this.extractFrame(
          absolutePath,
          timestamp,
          outputPath,
          context
        );
        if (extracted instanceof Error) {
          if (images.length === 0) {
            return { content: extracted.message, isError: true };
          }
          break;
        }
        images.push({
          mediaType: ImageMediaType.Jpeg,
          data: readFileSync(outputPath).toString('base64'),
        });
        captured.push(timestamp);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }

    if (images.length === 0) {
      return {
        content: `No frames could be extracted from ${parsed.path}.`,
        isError: true,
      };
    }

    return {
      content: format(parsed.path, duration, start, end, captured, frameCount),
      images,
    };
  }

  /** Video duration in seconds, or 0 when ffprobe can't determine it. */
  private async probeDuration(
    absolutePath: string,
    context: ToolExecutionContext
  ): Promise<number | Error> {
    const result = await this.run(
      this.binaries.ffprobePath ?? 'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=nokey=1:noprint_wrappers=1',
        absolutePath,
      ],
      context
    );
    if (result instanceof Error) {
      return result;
    }
    const seconds = Number.parseFloat(result.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  }

  private async extractFrame(
    absolutePath: string,
    timestamp: number,
    outputPath: string,
    context: ToolExecutionContext
  ): Promise<string | Error> {
    return this.run(
      this.binaries.ffmpegPath ?? 'ffmpeg',
      [
        '-nostdin',
        '-v',
        'error',
        '-ss',
        String(timestamp),
        '-i',
        absolutePath,
        '-frames:v',
        '1',
        '-vf',
        `scale='min(${MAX_VIDEO_FRAME_WIDTH},iw)':-2`,
        '-q:v',
        String(FRAME_JPEG_QUALITY),
        '-f',
        'image2',
        '-y',
        outputPath,
      ],
      context
    );
  }

  private run(
    command: string,
    args: string[],
    context: ToolExecutionContext
  ): Promise<string | Error> {
    return new Promise<string | Error>((resolvePromise) => {
      execFile(
        command,
        args,
        {
          timeout: FFMPEG_TIMEOUT_MS,
          maxBuffer: 8 * 1024 * 1024,
          ...(context.signal ? { signal: context.signal } : {}),
        },
        (error, stdout, stderr) => {
          if (!error) {
            resolvePromise(stdout);
            return;
          }
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') {
            resolvePromise(
              new Error(
                `'${command}' was not found on PATH. Install ffmpeg to read videos.`
              )
            );
            return;
          }
          const detail = (stderr || error.message).trim();
          resolvePromise(new Error(`${command} failed: ${detail}`));
        }
      );
    });
  }
}

function format(
  path: string,
  duration: number,
  start: number,
  end: number,
  timestamps: number[],
  requested: number
): string {
  const lines: string[] = [];
  lines.push(
    duration > 0
      ? `${path} — duration ${formatSeconds(duration)}`
      : `${path} — duration unknown`
  );
  lines.push(
    `Sampled ${timestamps.length} frame(s) between ${formatSeconds(start)} and ${formatSeconds(end)}:`
  );
  timestamps.forEach((timestamp, index) => {
    lines.push(`  frame ${index + 1}: ${formatSeconds(timestamp)}`);
  });
  if (timestamps.length < requested) {
    lines.push(
      `(only ${timestamps.length} of ${requested} requested frames could be extracted)`
    );
  }
  lines.push(
    `The frames follow as images. For more detail, call ${ToolName.ReadVideo} again with a ` +
      `higher "frames" (max ${MAX_VIDEO_FRAME_COUNT}) or a narrower ` +
      '"start_seconds"/"end_seconds" window.'
  );
  return lines.join('\n');
}

function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(2)}s`;
}

/**
 * Resolves a workspace-relative path to an absolute one, rejecting anything
 * that escapes the workspace root (or an absolute path pointing outside it).
 */
function resolveInsideWorkspace(
  workspaceRoot: string,
  path: string
): string | undefined {
  const root = resolve(workspaceRoot);
  const absolute = isAbsolute(path) ? resolve(path) : resolve(root, path);
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) {
    return undefined;
  }
  return absolute;
}

function tryParse(rawArguments: string): ReadVideoArguments | undefined {
  try {
    const parsed = JSON.parse(rawArguments) as Record<string, unknown>;
    if (typeof parsed.path !== 'string' || parsed.path.trim().length === 0) {
      return undefined;
    }
    const frames = numberOrUndefined(parsed.frames);
    const startSeconds = numberOrUndefined(parsed.start_seconds);
    const endSeconds = numberOrUndefined(parsed.end_seconds);
    return {
      path: parsed.path.trim(),
      ...(frames !== undefined ? { frames } : {}),
      ...(startSeconds !== undefined ? { startSeconds } : {}),
      ...(endSeconds !== undefined ? { endSeconds } : {}),
    };
  } catch {
    return undefined;
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}
