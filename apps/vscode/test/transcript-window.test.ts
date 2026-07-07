import { describe, expect, it } from 'vitest';

import { WebviewRole, type WebviewMessage } from '@ext/shared/protocol';
import { MESSAGE_WINDOW, windowMessages } from '@ext/webview/transcript-window';

function makeMessages(count: number): WebviewMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    role: WebviewRole.User,
    content: `message ${i}`,
  }));
}

describe('windowMessages', () => {
  it('returns everything when under the limit', () => {
    const messages = makeMessages(10);
    const result = windowMessages(messages, false);
    expect(result.visible).toBe(messages);
    expect(result.hiddenCount).toBe(0);
  });

  it('keeps only the newest `limit` messages and reports the hidden head', () => {
    const messages = makeMessages(1000);
    const result = windowMessages(messages, false, 200);
    expect(result.visible).toHaveLength(200);
    expect(result.hiddenCount).toBe(800);
    expect(result.visible[0]?.id).toBe('m800');
    expect(result.visible.at(-1)?.id).toBe('m999');
  });

  it('shows everything when showAll is set', () => {
    const messages = makeMessages(MESSAGE_WINDOW + 50);
    const result = windowMessages(messages, true);
    expect(result.visible).toBe(messages);
    expect(result.hiddenCount).toBe(0);
  });
});
