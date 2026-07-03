import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createConversation } from '@core/domain/conversation';
import { createMessage } from '@core/domain/message';
import {
  FileConversationRepository,
  sessionFilePath,
  sessionMessagesFilePath,
} from '@runtime/persistence/file-conversation-repository';

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

  it('keeps the summary file lean and the messages file complete', async () => {
    const repository = new FileConversationRepository(directory);
    const conversation = createConversation('split-session');
    conversation.messages.push(createMessage('user', 'hello there'));

    await repository.save(conversation);

    // The summary file lists without the bulky messages…
    const summaryRaw = JSON.parse(
      await readFileText(sessionFilePath(directory, 'split-session'))
    );
    expect(summaryRaw).toEqual({
      sessionId: 'split-session',
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messageCount: 1,
    });
    expect(summaryRaw.messages).toBeUndefined();

    // …while the messages file carries the full history for open.
    const messagesRaw = JSON.parse(
      await readFileText(sessionMessagesFilePath(directory, 'split-session'))
    );
    expect(messagesRaw.messages).toHaveLength(1);
    expect(messagesRaw.messages[0].content).toBe('hello there');
  });

  it('reads and migrates a legacy single-file session', async () => {
    const repository = new FileConversationRepository(directory);
    // A pre-split session: the full conversation lives in the summary file, with
    // no separate messages file.
    const legacy = createConversation('legacy-session');
    legacy.title = 'legacy';
    legacy.messages.push(createMessage('user', 'from the old layout'));
    await writeFile(
      sessionFilePath(directory, 'legacy-session'),
      `${JSON.stringify(legacy, null, 2)}\n`,
      'utf8'
    );

    // It lists (message count derived from the embedded messages)…
    await expect(repository.list()).resolves.toEqual([
      {
        sessionId: 'legacy-session',
        title: 'legacy',
        createdAt: legacy.createdAt,
        updatedAt: legacy.updatedAt,
        messageCount: 1,
      },
    ]);

    // …loads its history from the legacy file…
    const loaded = await repository.load('legacy-session');
    expect(loaded.messages).toHaveLength(1);
    expect(loaded.messages[0]?.content).toBe('from the old layout');

    // …and migrates to the split layout on the next save.
    await repository.save(loaded);
    const files = (await readdir(directory)).sort();
    expect(files).toEqual(['legacy-session.json', 'legacy-session.messages.json']);
  });

  it('clears both files for a session', async () => {
    const repository = new FileConversationRepository(directory);
    const conversation = createConversation('doomed');
    conversation.messages.push(createMessage('user', 'delete me'));
    await repository.save(conversation);

    await repository.clear('doomed');

    expect(await readdir(directory)).toEqual([]);
    await expect(repository.list()).resolves.toEqual([]);
  });
});

async function readFileText(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  return readFile(path, 'utf8');
}
