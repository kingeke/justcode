import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

import {
  createConversation,
  type Conversation,
} from '@core/domain/conversation';
import type {
  ConversationRepository,
  ConversationSummary,
} from '@core/ports/conversation-repository';

/**
 * Persists each session across two files so listing stays cheap as sessions
 * accumulate:
 *
 * - `<id>.json` — a lean summary (title, timestamps, message count) and nothing
 *   bulky. `list()` reads only these, so building the sessions list never parses
 *   megabytes of message history or embedded image data.
 * - `<id>.messages.json` — the full {@link Conversation} (messages, stats,
 *   active tools). Read only when a session is opened.
 *
 * Both are written together on every {@link save}, so they never drift. Sessions
 * saved before the split (full conversation in `<id>.json`) are read
 * transparently and migrate to the two-file layout the next time they're saved.
 */
export class FileConversationRepository implements ConversationRepository {
  public constructor(private readonly sessionsDirectory: string) {}

  public async load(sessionId: string): Promise<Conversation> {
    // The full conversation lives in the messages file. Fall back to the summary
    // file for sessions saved before the split, where it still holds everything.
    for (const filePath of [
      this.getMessagesFilePath(sessionId),
      this.getFilePath(sessionId),
    ]) {
      try {
        const raw = await readFile(filePath, 'utf8');
        const conversation = JSON.parse(raw) as Conversation;
        // A migrated summary file has no messages; only accept it as a fallback
        // when it actually carries history (i.e. a legacy full file).
        if (Array.isArray(conversation.messages)) {
          return conversation;
        }
      } catch (error) {
        if (!isFileMissingError(error)) throw error;
      }
    }

    return createConversation(sessionId);
  }

  public async clear(sessionId: string): Promise<void> {
    await Promise.all(
      [this.getMessagesFilePath(sessionId), this.getFilePath(sessionId)].map(
        async (filePath) => {
          try {
            await rm(filePath);
          } catch (error) {
            if (!isFileMissingError(error)) throw error;
          }
        }
      )
    );
  }

  public async save(conversation: Conversation): Promise<void> {
    await mkdir(this.sessionsDirectory, { recursive: true });

    // Write the full conversation first (the source of truth), then derive the
    // lean summary from it. If a crash lands between the two, the summary is at
    // worst stale — the next save reconciles it.
    await writeFile(
      this.getMessagesFilePath(conversation.sessionId),
      `${JSON.stringify(conversation, null, 2)}\n`,
      'utf8'
    );

    const summary: ConversationSummary = {
      sessionId: conversation.sessionId,
      ...(conversation.title ? { title: conversation.title } : {}),
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messageCount: conversation.messages.length,
    };
    await writeFile(
      this.getFilePath(conversation.sessionId),
      `${JSON.stringify(summary, null, 2)}\n`,
      'utf8'
    );
  }

  public async list(): Promise<ConversationSummary[]> {
    try {
      const entries = await readdir(this.sessionsDirectory, {
        withFileTypes: true,
      });
      const sessions = await Promise.all(
        entries
          .filter(
            (entry) =>
              entry.isFile() &&
              entry.name.endsWith('.json') &&
              !entry.name.endsWith('.messages.json')
          )
          .map(async (entry) => {
            const filePath = join(this.sessionsDirectory, entry.name);
            const raw = await readFile(filePath, 'utf8');
            // Either a lean summary (new layout) or a full conversation (a
            // legacy file not yet migrated) — both carry the summary fields, and
            // a legacy file still has `messages` to count.
            const record = JSON.parse(raw) as ConversationSummary &
              Partial<Conversation>;
            const messageCount =
              record.messageCount ?? record.messages?.length ?? 0;
            const needsStat =
              record.createdAt === undefined || record.updatedAt === undefined;
            const fileStat = needsStat ? await stat(filePath) : undefined;
            return {
              sessionId: record.sessionId,
              ...(record.title ? { title: record.title } : {}),
              createdAt:
                record.createdAt ?? fileStat?.birthtime.toISOString() ?? '',
              updatedAt:
                record.updatedAt ?? fileStat?.mtime.toISOString() ?? '',
              messageCount,
            } satisfies ConversationSummary;
          })
      );

      return sessions.sort(
        (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
      );
    } catch (error) {
      if (isFileMissingError(error)) {
        return [];
      }

      throw error;
    }
  }

  private getFilePath(sessionId: string): string {
    return sessionFilePath(this.sessionsDirectory, sessionId);
  }

  private getMessagesFilePath(sessionId: string): string {
    return sessionMessagesFilePath(this.sessionsDirectory, sessionId);
  }
}

/**
 * Absolute path to a session's lean summary file (title, timestamps, count).
 * See {@link sessionMessagesFilePath} for the full conversation.
 */
export function sessionFilePath(
  sessionsDirectory: string,
  sessionId: string
): string {
  return join(sessionsDirectory, `${sanitizeSessionId(sessionId)}.json`);
}

/** Absolute path to a session's full conversation file (its message history). */
export function sessionMessagesFilePath(
  sessionsDirectory: string,
  sessionId: string
): string {
  return join(
    sessionsDirectory,
    `${sanitizeSessionId(sessionId)}.messages.json`
  );
}

function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function isFileMissingError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
