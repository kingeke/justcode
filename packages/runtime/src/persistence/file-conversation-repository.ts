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

export class FileConversationRepository implements ConversationRepository {
  public constructor(private readonly sessionsDirectory: string) {}

  public async load(sessionId: string): Promise<Conversation> {
    const filePath = this.getFilePath(sessionId);

    try {
      const rawConversation = await readFile(filePath, 'utf8');
      return JSON.parse(rawConversation) as Conversation;
    } catch (error) {
      if (isFileMissingError(error)) {
        return createConversation(sessionId);
      }

      throw error;
    }
  }

  public async clear(sessionId: string): Promise<void> {
    const filePath = this.getFilePath(sessionId);
    try {
      await rm(filePath);
    } catch (error) {
      if (!isFileMissingError(error)) throw error;
    }
  }

  public async save(conversation: Conversation): Promise<void> {
    const filePath = this.getFilePath(conversation.sessionId);

    await mkdir(this.sessionsDirectory, { recursive: true });
    await writeFile(
      filePath,
      `${JSON.stringify(conversation, null, 2)}\n`,
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
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map(async (entry) => {
            const filePath = join(this.sessionsDirectory, entry.name);
            const rawConversation = await readFile(filePath, 'utf8');
            const conversation = JSON.parse(rawConversation) as Conversation;
            const fileStat = await stat(filePath);
            return {
              sessionId: conversation.sessionId,
              ...(conversation.title ? { title: conversation.title } : {}),
              createdAt:
                conversation.createdAt ?? fileStat.birthtime.toISOString(),
              updatedAt: conversation.updatedAt ?? fileStat.mtime.toISOString(),
              messageCount: conversation.messages.length,
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
}

/** Absolute path to a session's persisted conversation file (its `chat.json`). */
export function sessionFilePath(
  sessionsDirectory: string,
  sessionId: string
): string {
  return join(sessionsDirectory, `${sanitizeSessionId(sessionId)}.json`);
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
