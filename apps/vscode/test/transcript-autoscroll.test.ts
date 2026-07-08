import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('transcript auto-scroll stickiness', () => {
  const app = readFileSync(
    join(process.cwd(), 'apps/vscode/src/webview/App.tsx'),
    'utf8'
  );

  it('re-sticks near the bottom and unsticks only on an upward user scroll', () => {
    // Sticking is distance-based; unsticking requires the scroll to have moved
    // up (programmatic pins only move down), so a streaming pin's own scroll
    // event can never be misread as the user scrolling away.
    expect(app).toContain('lastScrollTopRef');
    expect(app).toMatch(
      /if \(distanceFromBottom <= 24\) \{\s*stickToBottomRef\.current = true;\s*\} else if \(el\.scrollTop < lastScrollTop\) \{\s*stickToBottomRef\.current = false;/
    );
    // The old racy form (unstick derived from distance alone) must not return.
    expect(app).not.toContain(
      'stickToBottomRef.current = distanceFromBottom <= 24'
    );
  });

  it('pins on every live-turn update while stuck, not only on resize', () => {
    // The state-driven pin: streaming/thinking/commit/tool updates re-pin as
    // long as the user hasn't scrolled away, so following the live turn can't
    // die to a missed ResizeObserver beat.
    expect(app).toMatch(
      /state\.streaming,\s*state\.thinking,\s*state\.messages\.length,\s*state\.liveTurnItems,\s*pinToBottom,\s*\]\);/
    );
  });

  it('unsticks on an upward wheel — explicit user intent', () => {
    expect(app).toContain('onTranscriptWheel');
    expect(app).toContain(
      'if (event.deltaY < 0) stickToBottomRef.current = false;'
    );
  });

  it('sending a message always re-arms auto-scroll', () => {
    expect(app).toContain('stickToBottomRef.current = true;');
    expect(app).toContain('requestAnimationFrame(pinToBottom)');
  });
});
