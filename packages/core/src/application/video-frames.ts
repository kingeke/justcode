/**
 * Frame-sampling limits for the `read_video` tool. Frames are sent to the model
 * as images, so the count directly drives how much context a single video read
 * spends — hence a conservative default the user can raise, and a hard cap the
 * model can never exceed by asking for more frames.
 */

/** Frames sampled per video read when neither config nor the call says otherwise. */
export const DEFAULT_VIDEO_FRAME_COUNT = 8;

/** Fewest frames a single read may sample. */
export const MIN_VIDEO_FRAME_COUNT = 1;

/** Most frames a single read may sample, whatever the caller or config asks for. */
export const MAX_VIDEO_FRAME_COUNT = 32;

/** Longest edge (in pixels) an extracted frame is scaled down to. */
export const MAX_VIDEO_FRAME_WIDTH = 768;

/** Clamps a requested frame count into the supported range, dropping fractions. */
export function clampVideoFrameCount(count: number): number {
  if (!Number.isFinite(count)) {
    return DEFAULT_VIDEO_FRAME_COUNT;
  }
  const whole = Math.floor(count);
  if (whole < MIN_VIDEO_FRAME_COUNT) {
    return MIN_VIDEO_FRAME_COUNT;
  }
  if (whole > MAX_VIDEO_FRAME_COUNT) {
    return MAX_VIDEO_FRAME_COUNT;
  }
  return whole;
}

/**
 * Evenly spaced sample timestamps (seconds) across `[start, end]`. Each frame
 * sits at the midpoint of its slice, so the first and last frames are inside the
 * window rather than exactly on its edges (where a seek often lands on black).
 */
export function videoFrameTimestamps(
  start: number,
  end: number,
  frames: number
): number[] {
  const count = clampVideoFrameCount(frames);
  const span = end - start;
  if (span <= 0) {
    return [Math.max(0, start)];
  }
  const slice = span / count;
  const timestamps: number[] = [];
  for (let index = 0; index < count; index += 1) {
    timestamps.push(
      Math.max(0, Number((start + slice * (index + 0.5)).toFixed(3)))
    );
  }
  return timestamps;
}
