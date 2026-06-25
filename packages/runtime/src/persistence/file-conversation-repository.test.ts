import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createConversation } from '@core/domain/conversation';
import { createMessage } from '@core/domain/message';
import { FileConversationRepository } from '@runtime/persistence/file-conversation-repository';

describe('FileConversationRepository', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'justcode-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('returns an empty conversation when a session file does not exist', async () => {
    const repository = new FileConversationRepository(directory);

    const conversation = await repository.load('new-session');

    expect(conversation.sessionId).toBe('new-session');
    expect(conversation.messages).toEqual([]);
  });

  it('persists and reloads conversation history', async () => {
    const repository = new FileConversationRepository(directory);
    const conversation = createConversation('my/session');
    conversation.title = 'project-planning-2026-06-26-1530';
    conversation.messages.push(createMessage('user', 'Hello'));
    conversation.messages.push(
      createMessage('assistant', 'partial answer', new Date(), undefined, {
        thinking: { content: 'thinking aloud', durationMs: 123 },
      })
    );

    await repository.save(conversation);

    const reloadedConversation = await repository.load('my/session');

    expect(reloadedConversation.title).toBe('project-planning-2026-06-26-1530');
    expect(reloadedConversation.messages).toHaveLength(2);
    expect(reloadedConversation.messages[0]?.content).toBe('Hello');
    expect(reloadedConversation.messages[1]?.thinking).toEqual({
      content: 'thinking aloud',
      durationMs: 123,
    });
  });

  it('lists saved sessions sorted by most recent activity', async () => {
    const repository = new FileConversationRepository(directory);

    const olderConversation = createConversation('older-session', new Date(1));
    const newerConversation = createConversation('newer-session', new Date(2));
    newerConversation.messages.push(createMessage('user', 'recent'));

    await repository.save(olderConversation);
    await repository.save(newerConversation);

    await expect(repository.list()).resolves.toEqual([
      {
        sessionId: 'newer-session',
        createdAt: newerConversation.createdAt,
        updatedAt: newerConversation.updatedAt,
        messageCount: 1,
      },
      {
        sessionId: 'older-session',
        createdAt: olderConversation.createdAt,
        updatedAt: olderConversation.updatedAt,
        messageCount: 0,
      },
    ]);
  });
});
