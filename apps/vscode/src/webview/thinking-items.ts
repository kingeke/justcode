import { WebviewRole } from '@ext/shared/protocol';

export interface ThinkingRenderItem {
  id: string;
  content: string;
  durationMs: number;
}

export interface ThinkingSelectionInput {
  message: {
    role: WebviewRole;
    id: string;
    thinking?: { content: string; durationMs: number };
  };
  isLastAssistant: boolean;
  committedMessagesHaveThinking: boolean;
  completedThinkingItems: ThinkingRenderItem[];
}

/**
 * Chooses the thinking blocks to render above a committed message. Prefers the
 * message's own persisted thinking so each "Thought" block interleaves with its
 * step's tool cards. Only falls back to the turn's streamed thinking on the last
 * assistant when NO committed message carries thinking (legacy providers whose
 * transcript omits it) — otherwise the same segments would render twice, dumped
 * after the tool calls.
 */
export function selectThinkingItems({
  message,
  isLastAssistant,
  committedMessagesHaveThinking,
  completedThinkingItems,
}: ThinkingSelectionInput): ThinkingRenderItem[] {
  if (message.role === WebviewRole.Assistant && message.thinking) {
    return [
      {
        id: `${message.id}-thinking`,
        content: message.thinking.content,
        durationMs: message.thinking.durationMs,
      },
    ];
  }
  if (isLastAssistant && !committedMessagesHaveThinking) {
    return completedThinkingItems;
  }
  return [];
}
