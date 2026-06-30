import { describe, expect, it } from 'vitest';

import { WebviewRole } from '@ext/shared/protocol';
import { LocalActionType, initialState, reducer } from '@ext/webview/state';

describe('optimistic submit with images', () => {
  it('attaches pasted images to the optimistic user message', () => {
    const state = reducer(initialState, {
      type: LocalActionType.OptimisticSubmit,
      content: 'what is this',
      images: [{ id: 'i1', mediaType: 'image/png', data: 'AAAA' }],
    });

    const last = state.messages.at(-1);
    expect(last?.role).toBe(WebviewRole.User);
    expect(last?.images).toEqual([{ mediaType: 'image/png', data: 'AAAA' }]);
    // The webview-only id is stripped; only wire fields are kept.
    expect(state.busy).toBe(true);
  });

  it('omits the images field when none were pasted', () => {
    const state = reducer(initialState, {
      type: LocalActionType.OptimisticSubmit,
      content: 'plain text',
      images: [],
    });

    expect(state.messages.at(-1)?.images).toBeUndefined();
  });
});
