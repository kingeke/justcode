import { MessageRole, type ChatMessage } from '@core/domain/message';

/**
 * Pairs each tool result with the tool call that produced it.
 *
 * A turn that calls several tools at once arrives as ONE assistant message
 * carrying every tool call, followed by one `tool` message per result. Rendering
 * the transcript in message order therefore stacks all the `⚙ tool(...)` lines
 * and then all the result boxes, detaching each result from its call. (While the
 * turn streams, the optimistic splice emits one call per assistant message, so
 * the live view interleaves correctly and then "jumps" to the stacked layout
 * when the real messages commit.)
 *
 * Pairing lets the transcript render call → result, call → result in both views.
 */
export function toolResultsByCallId(
  messages: readonly ChatMessage[]
): Map<string, ChatMessage> {
  const results = new Map<string, ChatMessage>();
  for (const message of messages) {
    if (message.role === MessageRole.Tool && message.toolCallId) {
      results.set(message.toolCallId, message);
    }
  }
  return results;
}

/**
 * Ids of the tool messages that {@link toolResultsByCallId} matched to a call,
 * so the top-level render pass can skip them — they're drawn inline under their
 * call instead. A result whose assistant message is missing (an older session, a
 * truncated history) stays unpaired and still renders on its own, in order.
 */
export function pairedToolResultIds(
  messages: readonly ChatMessage[],
  resultsByCallId: Map<string, ChatMessage>
): Set<string> {
  const paired = new Set<string>();
  for (const message of messages) {
    if (message.role !== MessageRole.Assistant || !message.toolCalls) continue;
    for (const call of message.toolCalls) {
      const result = resultsByCallId.get(call.id);
      if (result) paired.add(result.id);
    }
  }
  return paired;
}
