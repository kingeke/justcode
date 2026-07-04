import type { ChatMessage } from '@core/domain/message';

/**
 * The footer metrics of a session (ctx/cost/tok-s), persisted with the
 * conversation so resuming it restores them instead of starting from zero.
 * Written by the hosts (CLI/extension) at the end of each turn — the core
 * engine doesn't compute cost or timing, the hosts do.
 */
export interface SessionStats {
  /** Cumulative input tokens across every turn. */
  inputTokens: number;
  /** Cumulative output tokens across every turn. */
  outputTokens: number;
  /** Cumulative cache-read tokens across every turn. */
  cachedTokens: number;
  /** Cumulative cost in dollars (reported or estimated from model pricing). */
  cost: number;
  /** Input tokens of the most recent request — drives the ctx(%) readout. */
  lastInputTokens: number;
  /** Time to first token of the most recent turn, in milliseconds. */
  ttftMs?: number;
  /** Generation rate of the most recent turn, in tokens per second. */
  tokensPerSecond?: number;
  /**
   * Mean tok/s across every completed turn, maintained incrementally from the
   * previous average (newAvg = oldAvg + (sample − oldAvg) / count) rather than
   * re-averaged from a sample list.
   */
  avgTokensPerSecond?: number;
  /** Number of completed turns folded into {@link avgTokensPerSecond}. */
  completedTurnCount?: number;
}

export interface Conversation {
  sessionId: string;
  title?: string;
  messages: ChatMessage[];
  /**
   * Message histories of prior compaction epochs, oldest first. Every
   * compaction appends the then-current `messages` here before resetting
   * `messages` to the summary. Never sent to the model — UIs render these
   * above the active messages so the full transcript stays visible.
   */
  previousMessages?: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  /** Footer metrics carried across reloads; absent for pre-stats sessions. */
  stats?: SessionStats;
  /**
   * Names of the tools the model has switched on via the `lazy_load_tools`
   * gateway, persisted so resuming the session restores the same working set
   * instead of forcing the model to rediscover it. Absent for sessions that
   * never toggled anything (including pre-toggle sessions, which fall back to
   * the legacy "gateway call loads everything" behavior).
   */
  activeTools?: string[];
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
