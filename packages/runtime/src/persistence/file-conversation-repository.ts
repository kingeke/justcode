import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  createConversation,
  type Conversation,
} from '@core/domain/conversation';
import type { ConversationRepository } from '@core/ports/conversation-repository';

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

  private getFilePath(sessionId: string): string {
    return join(this.sessionsDirectory, `${sanitizeSessionId(sessionId)}.json`);
  }
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
