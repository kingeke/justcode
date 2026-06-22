import type { Conversation } from '@core/domain/conversation';

export interface ConversationRepository {
  load(sessionId: string): Promise<Conversation>;
  save(conversation: Conversation): Promise<void>;
  clear(sessionId: string): Promise<void>;
}
