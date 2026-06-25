import type { Conversation } from '@core/domain/conversation';

export interface ConversationSummary {
  sessionId: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ConversationRepository {
  load(sessionId: string): Promise<Conversation>;
  save(conversation: Conversation): Promise<void>;
  clear(sessionId: string): Promise<void>;
  list(): Promise<ConversationSummary[]>;
}
