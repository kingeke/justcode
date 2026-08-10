import { describe, expect, it } from 'vitest';

import {
  jumpScrollTop,
  SCROLL_JUMP_OFFSET,
} from '@ext/webview/transcript-scroll';

describe('jumpScrollTop', () => {
  it('leaves the default gap above the target message', () => {
    // A message 300px below the container's top edge, container scrolled 100px.
    expect(
      jumpScrollTop({
        containerScrollTop: 100,
        containerTop: 50,
        nodeTop: 350,
      })
    ).toBe(400 - SCROLL_JUMP_OFFSET);
  });

  it('honours an explicit offset', () => {
    expect(
      jumpScrollTop({
        containerScrollTop: 100,
        containerTop: 50,
        nodeTop: 350,
        offset: 10,
      })
    ).toBe(390);
  });

  it('clamps at the top of the transcript', () => {
    expect(
      jumpScrollTop({
        containerScrollTop: 0,
        containerTop: 50,
        nodeTop: 60,
      })
    ).toBe(0);
  });
});
