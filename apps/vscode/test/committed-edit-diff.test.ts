import { describe, expect, it } from 'vitest';

import { createConversation } from '@core/domain/conversation';
import { createMessage } from '@core/domain/message';
import { toWebviewMessages } from '@ext/host/chat-bridge';
import type { WebviewToolView } from '@ext/shared/protocol';

const diff = { path: 'a.ts', oldText: 'one\n', newText: 'ONE\n' };

// The cache hits, so the registry is never consulted, but the function needs a
// truthy `services` to walk the assistant message's toolCalls.
const services = {
  toolRegistry: { get: () => undefined },
  workspaceRoot: '/ws',
} as never;

function conversationWith(toolResult: string) {
  const conversation = createConversation('s1');
  conversation.messages = [
    createMessage('user', 'edit it', new Date()),
    createMessage('assistant', '', new Date(), undefined, {
      toolCalls: [{ id: 'e1', name: 'edit_file', arguments: '{}' }],
    }),
    createMessage('tool', toolResult, new Date(), undefined, {
      toolCallId: 'e1',
      name: 'edit_file',
    }),
  ];
  return conversation;
}

const cached = new Map<string, WebviewToolView>([
  ['e1', { title: 'edit a.ts', diff }],
]);

describe('toWebviewMessages — committed edit diff', () => {
  it('keeps the diff on an applied edit and leaves it unflagged', async () => {
    const messages = await toWebviewMessages(
      conversationWith('Edited a.ts (1 replacement replaced).'),
      services,
      cached
    );
    const tool = messages.find((m) => m.toolName === 'edit_file');

    expect(tool?.toolView?.diff).toEqual(diff);
    expect(tool?.toolView?.isError).toBeUndefined();
  });

  it('flags a rejected edit so the changes panel can exclude it', async () => {
    const messages = await toWebviewMessages(
      conversationWith('The user rejected this tool call.'),
      services,
      cached
    );
    const tool = messages.find((m) => m.toolName === 'edit_file');

    // Diff stays for the card, but the error flag keeps it out of the aggregate.
    expect(tool?.toolView?.diff).toEqual(diff);
    expect(tool?.toolView?.isError).toBe(true);
  });
});
