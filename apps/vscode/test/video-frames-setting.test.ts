import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VIDEO_FRAME_COUNT,
  MAX_VIDEO_FRAME_COUNT,
  MIN_VIDEO_FRAME_COUNT,
} from '@core/application/video-frames';
import { LocalActionType, initialState, reducer } from '@ext/webview/state';

describe('video frames setting', () => {
  it('starts at the shared default', () => {
    expect(initialState.videoFrameCount).toBe(DEFAULT_VIDEO_FRAME_COUNT);
  });

  it('stores the user’s frame count', () => {
    const state = reducer(initialState, {
      type: LocalActionType.SetVideoFrames,
      frames: 12,
    });

    expect(state.videoFrameCount).toBe(12);
  });

  it('clamps values outside the supported range', () => {
    expect(
      reducer(initialState, {
        type: LocalActionType.SetVideoFrames,
        frames: 500,
      }).videoFrameCount
    ).toBe(MAX_VIDEO_FRAME_COUNT);
    expect(
      reducer(initialState, {
        type: LocalActionType.SetVideoFrames,
        frames: 0,
      }).videoFrameCount
    ).toBe(MIN_VIDEO_FRAME_COUNT);
  });
});
