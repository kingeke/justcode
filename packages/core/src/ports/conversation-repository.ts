import type { Conversation } from '@core/domain/conversation';
import type { ModelReference } from '@core/domain/model-default';

export interface ConversationSummary {
  sessionId: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  /** Whether the user pinned this session; pinned sessions list first. */
  pinned?: boolean;
  /**
   * The provider+model the session last talked to, so session lists can show
   * it. Absent for sessions saved before the field existed.
   */
  model?: ModelReference;
}

export interface ConversationRepository {
  load(sessionId: string): Promise<Conversation>;
  save(conversation: Conversation): Promise<void>;
  clear(sessionId: string): Promise<void>;
  list(): Promise<ConversationSummary[]>;
}
