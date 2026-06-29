import { describe, expect, it } from 'vitest';

import { createConversation } from '@core/domain/conversation';
import { createMessage } from '@core/domain/message';
import { toWebviewMessages } from '@ext/host/chat-bridge';
import type { WebviewToolView } from '@ext/shared/protocol';

describe('toWebviewMessages — committed bash deletion diff', () => {
  it('carries a cached bash deletion diff onto the committed tool message', async () => {
    const conversation = createConversation('s1');
    conversation.messages = [
      createMessage('user', 'delete it', new Date()),
      createMessage('assistant', '', new Date(), undefined, {
        toolCalls: [
          { id: 'b1', name: 'bash', arguments: '{"command":"rm gone.ts"}' },
        ],
      }),
      createMessage('tool', 'deleted', new Date(), undefined, {
        toolCallId: 'b1',
        name: 'bash',
      }),
    ];

    const cached = new Map<string, WebviewToolView>([
      [
        'b1',
        {
          title: 'bash: rm gone.ts',
          preview: 'rm gone.ts',
          diff: { path: 'gone.ts', oldText: 'content\n', newText: '' },
        },
      ],
    ]);

    // A minimal services stand-in: the cache hits, so the tool registry is never
    // consulted, but the function requires a truthy `services` to walk toolCalls.
    const services = {
      toolRegistry: { get: () => undefined },
      workspaceRoot: '/ws',
    } as never;

    const messages = await toWebviewMessages(conversation, services, cached);
    const toolMessage = messages.find((m) => m.toolName === 'bash');

    expect(toolMessage?.toolView?.diff).toEqual({
      path: 'gone.ts',
      oldText: 'content\n',
      newText: '',
    });
  });
});
