import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VIDEO_FRAME_COUNT,
  MAX_VIDEO_FRAME_COUNT,
  MIN_VIDEO_FRAME_COUNT,
  clampVideoFrameCount,
  videoFrameTimestamps,
} from '@core/application/video-frames';

describe('clampVideoFrameCount', () => {
  it('keeps counts inside the supported range', () => {
    expect(clampVideoFrameCount(12)).toBe(12);
    expect(clampVideoFrameCount(0)).toBe(MIN_VIDEO_FRAME_COUNT);
    expect(clampVideoFrameCount(-5)).toBe(MIN_VIDEO_FRAME_COUNT);
    expect(clampVideoFrameCount(500)).toBe(MAX_VIDEO_FRAME_COUNT);
  });

  it('drops fractions and falls back for non-finite values', () => {
    expect(clampVideoFrameCount(4.9)).toBe(4);
    expect(clampVideoFrameCount(Number.NaN)).toBe(DEFAULT_VIDEO_FRAME_COUNT);
  });
});

describe('videoFrameTimestamps', () => {
  it('spaces frames evenly at slice midpoints', () => {
    expect(videoFrameTimestamps(0, 10, 5)).toEqual([1, 3, 5, 7, 9]);
  });

  it('samples inside a narrowed window', () => {
    expect(videoFrameTimestamps(10, 14, 2)).toEqual([11, 13]);
  });

  it('returns a single timestamp when the window has no span', () => {
    expect(videoFrameTimestamps(7, 7, 8)).toEqual([7]);
    expect(videoFrameTimestamps(7, 3, 8)).toEqual([7]);
  });

  it('caps the number of timestamps at the maximum', () => {
    expect(videoFrameTimestamps(0, 100, 1000)).toHaveLength(
      MAX_VIDEO_FRAME_COUNT
    );
  });
});
