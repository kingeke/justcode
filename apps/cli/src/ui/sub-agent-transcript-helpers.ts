import { MessageRole, type ChatMessage } from '@core/domain/message';
import type { SubAgentRun } from '@core/domain/sub-agent';

/** One-line summary of a tool call's arguments (mirrors the main transcript). */
export function summarizeToolArgs(rawArguments: string): string {
  try {
    const parsed = JSON.parse(rawArguments) as Record<string, unknown>;
    if (typeof parsed.path === 'string') return parsed.path;
    const keys = Object.keys(parsed);
    return keys.length ? keys.join(', ') : '';
  } catch {
    return rawArguments.length <= 40
      ? rawArguments
      : `${rawArguments.slice(0, 40)}…`;
  }
}

/** First line of a tool result, truncated so a row stays a single line. */
export function toolResultSummary(content: string, limit = 100): string {
  const line = content.split('\n', 1)[0] ?? '';
  return line.length <= limit ? line : `${line.slice(0, limit)}…`;
}

/**
 * The messages of a sub agent run worth showing: everything except the system
 * prompt (long, static instructions that would drown the actual transcript).
 */
export function transcriptMessages(run: SubAgentRun): ChatMessage[] {
  return run.messages.filter((message) => message.role !== MessageRole.System);
}
