import type { ChatMessage } from '@core/domain/message';

export interface Conversation {
  sessionId: string;
  title?: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export function createConversation(
  sessionId: string,
  now = new Date()
): Conversation {
  const timestamp = now.toISOString();

  return {
    sessionId,
    messages: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
