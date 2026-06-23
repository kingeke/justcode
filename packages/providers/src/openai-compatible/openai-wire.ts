import {
  renderMessageContentForModel,
  type ChatMessage,
  type ToolCall,
} from '@core/domain/message';
import type { ToolDefinition } from '@core/ports/tool';

/**
 * Translation helpers between justcode's domain messages/tools and the OpenAI
 * chat-completions wire format shared by OpenAI, LM Studio, and OpenRouter.
 */

interface WireToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface OpenAiWireMessage {
  role: string;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: WireToolCall[];
}

export function toOpenAiWireMessages(
  messages: ChatMessage[]
): OpenAiWireMessage[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        content: message.content,
        ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
      };
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    }

    return {
      role: message.role,
      content: renderMessageContentForModel(message),
    };
  });
}

export function toOpenAiToolDefinitions(
  tools: ToolDefinition[] | undefined
): Array<{ type: 'function'; function: ToolDefinition }> | undefined {
  if (!tools?.length) {
    return undefined;
  }

  return tools.map((tool) => ({ type: 'function' as const, function: tool }));
}

export interface RawOpenAiToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

/** Parse `message.tool_calls` from a non-streaming completion response. */
export function parseOpenAiToolCalls(
  raw: RawOpenAiToolCall[] | undefined
): ToolCall[] {
  if (!raw?.length) {
    return [];
  }

  return raw
    .map((toolCall, index) => ({
      id: toolCall.id ?? `call_${index}`,
      name: toolCall.function?.name ?? '',
      arguments: toolCall.function?.arguments ?? '',
    }))
    .filter((toolCall) => toolCall.name);
}
