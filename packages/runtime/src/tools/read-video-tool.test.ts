import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_VIDEO_FRAME_COUNT,
  MAX_VIDEO_FRAME_COUNT,
} from '@core/application/video-frames';
import { ImageMediaType } from '@core/domain/image-media-type';
import { NodePlatform } from '@core/domain/node-platform';
import { ToolName } from '@core/domain/tool-name';
import { ReadVideoTool } from '@runtime/tools/read-video-tool';

/** The fakes are POSIX shell scripts, so skip the suite on Windows. */
const describeOnPosix =
  process.platform === NodePlatform.Win32 ? describe.skip : describe;

describeOnPosix('ReadVideoTool', () => {
  let workspaceRoot: string;
  let binDirectory: string;
  let ffprobePath: string;
  let ffmpegPath: string;

  const writeScript = (name: string, body: string): string => {
    const path = join(binDirectory, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`, 'utf8');
    chmodSync(path, 0o755);
    return path;
  };

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'justcode-video-ws-'));
    binDirectory = mkdtempSync(join(tmpdir(), 'justcode-video-bin-'));
    writeFileSync(
      join(workspaceRoot, 'clip.mp4'),
      'not really a video',
      'utf8'
    );
    ffprobePath = writeScript('ffprobe-ok', 'echo 10.0');
    // ffmpeg's output path is the last argument; write recognisable bytes there.
    ffmpegPath = writeScript(
      'ffmpeg-ok',
      'for arg in "$@"; do out="$arg"; done\nprintf frame > "$out"'
    );
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(binDirectory, { recursive: true, force: true });
  });

  const makeTool = (
    defaultFrames = DEFAULT_VIDEO_FRAME_COUNT,
    overrides: { ffmpegPath?: string; ffprobePath?: string } = {}
  ): ReadVideoTool =>
    new ReadVideoTool(() => defaultFrames, {
      ffprobePath,
      ffmpegPath,
      ...overrides,
    });

  const run = (
    tool: ReadVideoTool,
    args: Record<string, unknown>
  ): Promise<{ content: string; isError?: boolean; images?: unknown[] }> =>
    tool.execute(JSON.stringify(args), { workspaceRoot });

  it('samples the configured default number of frames', async () => {
    const result = await run(makeTool(3), { path: 'clip.mp4' });

    expect(result.isError).toBeUndefined();
    expect(result.images).toHaveLength(3);
    expect(result.images?.[0]).toEqual({
      mediaType: ImageMediaType.Jpeg,
      data: Buffer.from('frame').toString('base64'),
    });
    expect(result.content).toContain('duration 10.00s');
    expect(result.content).toContain('Sampled 3 frame(s)');
  });

  it('lets the call override the default frame count', async () => {
    const result = await run(makeTool(2), { path: 'clip.mp4', frames: 6 });

    expect(result.images).toHaveLength(6);
    expect(result.content).toContain('Sampled 6 frame(s)');
  });

  it('caps the requested frame count at the maximum', async () => {
    const result = await run(makeTool(), { path: 'clip.mp4', frames: 1000 });

    expect(result.images).toHaveLength(MAX_VIDEO_FRAME_COUNT);
  });

  it('samples only the requested time window', async () => {
    const result = await run(makeTool(), {
      path: 'clip.mp4',
      frames: 2,
      start_seconds: 4,
      end_seconds: 6,
    });

    expect(result.content).toContain('between 4.00s and 6.00s');
    expect(result.content).toContain('frame 1: 4.50s');
    expect(result.content).toContain('frame 2: 5.50s');
  });

  it('reports a missing file', async () => {
    const result = await run(makeTool(), { path: 'missing.mp4' });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('File not found');
  });

  it('rejects paths outside the workspace', async () => {
    const result = await run(makeTool(), { path: '../escape.mp4' });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('outside the workspace');
  });

  it('reports unparseable arguments', async () => {
    const result = await makeTool().execute('{}', { workspaceRoot });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid arguments');
  });

  it('explains when ffmpeg is not installed', async () => {
    const result = await run(
      makeTool(1, { ffmpegPath: join(binDirectory, 'does-not-exist') }),
      { path: 'clip.mp4' }
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain('Install ffmpeg');
  });

  it('surfaces extraction failures', async () => {
    const failing = writeScript('ffmpeg-fail', 'echo boom >&2\nexit 1');
    const result = await run(makeTool(1, { ffmpegPath: failing }), {
      path: 'clip.mp4',
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('boom');
  });

  it('falls back to a single frame when the duration is unknown', async () => {
    const unknown = writeScript('ffprobe-unknown', 'echo N/A');
    const result = await run(makeTool(4, { ffprobePath: unknown }), {
      path: 'clip.mp4',
    });

    expect(result.images).toHaveLength(1);
    expect(result.content).toContain('duration unknown');
  });

  it('describes the call with the effective frame count', () => {
    expect(
      makeTool(5).describe(JSON.stringify({ path: 'clip.mp4' })).title
    ).toBe('read video clip.mp4 (5 frames)');
    expect(makeTool().describe('nonsense').title).toContain(ToolName.ReadVideo);
  });
});
