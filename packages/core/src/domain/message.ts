import { randomUUID } from 'node:crypto';

export type MessageRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}

export function createMessage(
  role: MessageRole,
  content: string,
  createdAt = new Date()
): ChatMessage {
  return {
    id: randomUUID(),
    role,
    content,
    createdAt: createdAt.toISOString(),
  };
}
