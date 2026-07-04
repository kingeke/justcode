/**
 * The conversation-compaction prompt and helpers. Compaction sends the whole
 * conversation to the model with this prompt appended as a *user* message —
 * the system prompt is left untouched so the request shares its prompt-cache
 * prefix with normal turns. The model's text reply becomes the summary that
 * seeds the post-compaction conversation (see `ChatSessionService.compactSession`).
 */

/**
 * Default summarization prompt. A user override (config `compactPrompt`)
 * replaces it entirely.
 */
export const DEFAULT_COMPACT_PROMPT = [
  'CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.',
  '',
  '- Do NOT use any tool. You already have all the context you need in the conversation above.',
  '- Your entire response must be a single markdown document — no preamble, no wrapper tags, no commentary about the task itself. Every line you produce will be kept, so write only the summary.',
  '',
  "Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions. This summary will replace the older conversation history, so it must capture everything essential for continuing the work without losing context: technical details, code patterns, file names, and architectural decisions.",
  '',
  'Before writing, review the whole conversation chronologically — not just the latest messages — so nothing early is dropped. Pay special attention to:',
  '',
  "- The user's explicit requests, and any feedback telling you to do something differently",
  '- Errors you ran into and how you fixed them',
  '- Security-relevant instructions or constraints the user stated (sensitive files or data to avoid, operations that must not be performed, credential or secret handling rules). These MUST be preserved verbatim in the summary so they continue to apply after compaction.',
  '- The most recent messages: the exact commands/tools just executed, their results, and what was being worked on when this summary was requested.',
  '',
  'Structure the document with exactly these markdown sections:',
  '',
  "## Primary Request and Intent\nAll of the user's explicit requests and intents, in detail.",
  '',
  '## Key Technical Concepts\nImportant technologies, frameworks, and patterns discussed.',
  '',
  '## Files and Code Sections\nSpecific files and code sections examined, modified, or created — include code snippets where important and why each file matters.',
  '',
  '## Errors and Fixes\nErrors encountered and how they were fixed, including any user feedback on them.',
  '',
  '## User Messages\nEvery non-tool-result user message, so feedback and changing intent are preserved. Keep security-relevant instructions verbatim.',
  '',
  '## Pending Tasks\nTasks you have explicitly been asked to work on that are not yet done.',
  '',
  '## Current Work\nPrecisely what was being worked on immediately before this summary request, with file names and code snippets where applicable.',
  '',
  "## Next Step\nThe next step directly in line with the most recent work and the user's explicit requests, quoting the most recent conversation verbatim where it defines the task. If the last task was concluded and no follow-up was requested, say so instead of inventing one.",
  '',
  'REMINDER: Do NOT call any tools. Respond with the markdown summary only — no preamble and no wrapper tags.',
].join('\n');

/**
 * Extracts the usable summary from a compaction reply. The default prompt asks
 * for a bare markdown document, but models trained on tag-style compaction
 * prompts (or a user-customized prompt) may still wrap their output — so a
 * `<summary>` block is unwrapped and any `<analysis>` scratch work is dropped,
 * ensuring the scratch never rides along in every future request. Anything
 * else is returned trimmed as-is.
 */
export function extractCompactSummary(content: string): string {
  const summaryMatch = /<summary>([\s\S]*?)<\/summary>/i.exec(content);
  if (summaryMatch?.[1]) {
    return summaryMatch[1].trim();
  }
  return content.replace(/<analysis>[\s\S]*?<\/analysis>/gi, '').trim();
}

/**
 * Default auto-compact threshold: when the last request used at least this
 * percent of the model's context window, hosts compact automatically at the
 * end of the turn. 0 disables auto-compact.
 */
export const DEFAULT_AUTO_COMPACT_THRESHOLD_PERCENT = 80;

/**
 * Expected summary size (in tokens) used to turn the streamed summary into a
 * progress percentage before any compaction has run. The real total is
 * unknowable until the model stops, so hosts show
 * `min(99, streamed / expected)` and replace the estimate with the previous
 * summary's actual size after each compaction.
 */
export const DEFAULT_EXPECTED_SUMMARY_TOKENS = 800;

/**
 * Estimated progress percentage for a compaction, from the summary tokens
 * streamed so far against the expected total. Capped at 99 — only the model
 * finishing gets to say 100.
 */
export function compactProgressPercent(
  streamedTokens: number,
  expectedTokens: number
): number {
  if (expectedTokens <= 0) return 0;
  return Math.min(99, Math.round((streamedTokens / expectedTokens) * 100));
}

/**
 * Opens the flagged user message that seeds a post-compaction conversation,
 * framing the summary as carried-over context rather than a fresh request.
 */
export const COMPACT_CONTINUATION_HEADER =
  'This session is continued from a previous conversation that was compacted to free up context. The previous conversation is summarized below — use it as established context and continue from where it leaves off:';

/** The full content of the summary message that starts a compacted epoch. */
export function buildCompactSummaryContent(summary: string): string {
  return `${COMPACT_CONTINUATION_HEADER}\n\n${summary}`;
}
