import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Conversation } from '@core/domain/conversation';
import {
  readGlobalConfig,
  writeGlobalConfig,
} from '@runtime/persistence/global-config';
import { FileConversationRepository } from '@runtime/persistence/file-conversation-repository';

/**
 * Backfills the split-file session layout: for every pre-split `<id>.json` that
 * still embeds its message history, writes the full conversation to a sibling
 * `<id>.messages.json` and rewrites `<id>.json` as a lean summary (via
 * {@link FileConversationRepository.save}, so the output matches a normal save).
 *
 * Already-migrated (lean) sessions are skipped, so it is safe to re-run, and a
 * single corrupt/unreadable session is skipped rather than aborting the rest.
 * Returns the number of sessions migrated.
 */
export async function migrateSessionsToSplitLayout(
  sessionsDirectory: string
): Promise<number> {
  let entries;
  try {
    entries = await readdir(sessionsDirectory, { withFileTypes: true });
  } catch {
    // No sessions directory yet — nothing to migrate.
    return 0;
  }

  const repository = new FileConversationRepository(sessionsDirectory);
  let migrated = 0;
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !entry.name.endsWith('.json') ||
      entry.name.endsWith('.messages.json')
    ) {
      continue;
    }
    const filePath = join(sessionsDirectory, entry.name);
    try {
      const record = JSON.parse(
        await readFile(filePath, 'utf8')
      ) as Partial<Conversation>;
      // Only a pre-split file carries an embedded messages array; a lean summary
      // (already migrated) has none, so it's left untouched.
      if (!Array.isArray(record.messages) || !record.sessionId) continue;
      await repository.save(record as Conversation);
      migrated += 1;
    } catch {
      // Skip a corrupt/unreadable session; the rest still migrate.
    }
  }
  return migrated;
}

/**
 * Runs {@link migrateSessionsToSplitLayout} exactly once, gated by the
 * `migrations.splitSessionMessages` flag in config.json. After a successful
 * pass the flag is set so it never runs again. Best-effort: any failure is
 * swallowed (the repository still migrates each session lazily on its next
 * save), and the flag is only set once the backfill itself completes.
 */
export async function runSplitSessionBackfillOnce(
  configDirectory: string,
  sessionsDirectory: string
): Promise<void> {
  try {
    const config = await readGlobalConfig(configDirectory);
    if (config.migrations?.splitSessionMessages) return;

    await migrateSessionsToSplitLayout(sessionsDirectory);

    await writeGlobalConfig(configDirectory, {
      ...config,
      migrations: { ...config.migrations, splitSessionMessages: true },
    });
  } catch {
    // Non-fatal: leave the flag unset so a later launch retries the backfill.
  }
}
