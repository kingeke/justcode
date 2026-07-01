import { describe, expect, it } from 'vitest';

import { WebviewRole } from '@ext/shared/protocol';
import { selectThinkingItems } from '@ext/webview/thinking-items';

const completed = [
  { id: 'c1', content: 'reasoning one', durationMs: 11 },
  { id: 'c2', content: 'reasoning two', durationMs: 13 },
];

describe('selectThinkingItems', () => {
  it("uses a message's own thinking, interleaved with its step", () => {
    const items = selectThinkingItems({
      message: {
        role: WebviewRole.Assistant,
        id: 'a1',
        thinking: { content: 'step reasoning', durationMs: 42 },
      },
      isLastAssistant: false,
      committedMessagesHaveThinking: true,
      completedThinkingItems: completed,
    });

    expect(items).toEqual([
      { id: 'a1-thinking', content: 'step reasoning', durationMs: 42 },
    ]);
  });

  it('does NOT dump completed thinking on the last assistant when messages already carry thinking (no duplication)', () => {
    // The last assistant here is a final answer with no thinking of its own,
    // but earlier steps already rendered their thinking inline — so the
    // streamed segments must not be re-rendered after the tool cards.
    const items = selectThinkingItems({
      message: { role: WebviewRole.Assistant, id: 'final' },
      isLastAssistant: true,
      committedMessagesHaveThinking: true,
      completedThinkingItems: completed,
    });

    expect(items).toEqual([]);
  });

  it('falls back to streamed thinking on the last assistant only when no message carries thinking (legacy providers)', () => {
    const items = selectThinkingItems({
      message: { role: WebviewRole.Assistant, id: 'final' },
      isLastAssistant: true,
      committedMessagesHaveThinking: false,
      completedThinkingItems: completed,
    });

    expect(items).toEqual(completed);
  });

  it('renders nothing for a non-last assistant without its own thinking', () => {
    const items = selectThinkingItems({
      message: { role: WebviewRole.Assistant, id: 'mid' },
      isLastAssistant: false,
      committedMessagesHaveThinking: false,
      completedThinkingItems: completed,
    });

    expect(items).toEqual([]);
  });
});
