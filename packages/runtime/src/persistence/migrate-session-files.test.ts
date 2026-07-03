import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createConversation } from '@core/domain/conversation';
import { createMessage } from '@core/domain/message';
import {
  FileConversationRepository,
  sessionFilePath,
} from '@runtime/persistence/file-conversation-repository';
import { readGlobalConfig } from '@runtime/persistence/global-config';
import {
  migrateSessionsToSplitLayout,
  runSplitSessionBackfillOnce,
} from '@runtime/persistence/migrate-session-files';

describe('session split backfill', () => {
  let configDir: string;
  let sessionsDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'justcode-cfg-'));
    sessionsDir = join(configDir, 'sessions');
    await mkdir(sessionsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  async function writeLegacySession(sessionId: string): Promise<void> {
    const conversation = createConversation(sessionId);
    conversation.title = `title-${sessionId}`;
    conversation.messages.push(createMessage('user', `hi from ${sessionId}`));
    await writeFile(
      sessionFilePath(sessionsDir, sessionId),
      `${JSON.stringify(conversation, null, 2)}\n`,
      'utf8'
    );
  }

  it('splits legacy files and leaves the history intact', async () => {
    await writeLegacySession('alpha');
    await writeLegacySession('beta');

    const migrated = await migrateSessionsToSplitLayout(sessionsDir);
    expect(migrated).toBe(2);

    // Summary files are now lean; each has a sibling messages file.
    const files = (await readdir(sessionsDir)).sort();
    expect(files).toEqual([
      'alpha.json',
      'alpha.messages.json',
      'beta.json',
      'beta.messages.json',
    ]);

    const summary = JSON.parse(
      await readFile(sessionFilePath(sessionsDir, 'alpha'), 'utf8')
    );
    expect(summary.messages).toBeUndefined();
    expect(summary.messageCount).toBe(1);

    // The repository still loads the full history from the messages file.
    const repository = new FileConversationRepository(sessionsDir);
    const loaded = await repository.load('alpha');
    expect(loaded.messages[0]?.content).toBe('hi from alpha');
  });

  it('is idempotent — a second pass migrates nothing', async () => {
    await writeLegacySession('alpha');

    expect(await migrateSessionsToSplitLayout(sessionsDir)).toBe(1);
    expect(await migrateSessionsToSplitLayout(sessionsDir)).toBe(0);
  });

  it('runs once and records completion in config, skipping later runs', async () => {
    await writeLegacySession('alpha');

    await runSplitSessionBackfillOnce(configDir, sessionsDir);

    // Flag persisted so the backfill never repeats.
    const config = await readGlobalConfig(configDir);
    expect(config.migrations?.splitSessionMessages).toBe(true);

    // A legacy session added after the flag is set is not re-backfilled…
    await writeLegacySession('beta');
    await runSplitSessionBackfillOnce(configDir, sessionsDir);
    const betaFiles = (await readdir(sessionsDir)).filter((f) =>
      f.startsWith('beta')
    );
    // …so beta stays a single legacy file (the repository migrates it lazily on
    // its next save instead).
    expect(betaFiles).toEqual(['beta.json']);
  });
});
