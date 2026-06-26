import {
  renderMessageContentForModel,
  type ChatMessage,
  type ToolCall,
} from '@core/domain/message';
import type { ToolDefinition } from '@core/ports/tool';

/**
 * Translation helpers between justcode's domain messages/tools and the OpenAI
 * Responses API wire format used by the Codex backend (ChatGPT subscription
 * sign-in). This is a different protocol from Chat Completions: the system
 * prompt becomes top-level `instructions`, prior turns become typed `input`
 * items, and tools are flattened (no `function` wrapper).
 */

export interface ResponsesInputItem {
  type: 'message' | 'function_call' | 'function_call_output';
  role?: 'user' | 'assistant';
  content?: Array<{ type: 'input_text' | 'output_text'; text: string }>;
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: string;
}

export interface ResponsesToolDefinition {
  type: 'function';
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export interface ResponsesPayload {
  instructions?: string;
  input: ResponsesInputItem[];
}

/**
 * Splits domain messages into the Responses API shape: a single `instructions`
 * string (concatenated system messages) plus an ordered `input` list of typed
 * items. Assistant tool-call requests and `tool` results are emitted as
 * `function_call` / `function_call_output` items keyed by `call_id` so the
 * backend can thread them together.
 */
export function toResponsesPayload(messages: ChatMessage[]): ResponsesPayload {
  const instructions: string[] = [];
  const input: ResponsesInputItem[] = [];

  for (const message of messages) {
    if (message.role === 'system') {
      if (message.content.trim()) instructions.push(message.content);
      continue;
    }

    if (message.role === 'tool') {
      input.push({
        type: 'function_call_output',
        ...(message.toolCallId ? { call_id: message.toolCallId } : {}),
        output: message.content,
      });
      continue;
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      if (message.content.trim()) {
        input.push({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: message.content }],
        });
      }
      for (const call of message.toolCalls) {
        input.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: call.arguments,
        });
      }
      continue;
    }

    const text = renderMessageContentForModel(message);
    input.push({
      type: 'message',
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: [
        {
          type: message.role === 'assistant' ? 'output_text' : 'input_text',
          text,
        },
      ],
    });
  }

  return {
    ...(instructions.length ? { instructions: instructions.join('\n\n') } : {}),
    input,
  };
}

export function toResponsesToolDefinitions(
  tools: ToolDefinition[] | undefined
): ResponsesToolDefinition[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((tool) => ({
    type: 'function' as const,
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    parameters: tool.parameters as Record<string, unknown>,
  }));
}

/** A function call assembled from `response.output_item.done` events. */
export function toToolCall(item: {
  call_id?: string;
  id?: string;
  name?: string;
  arguments?: string;
}): ToolCall | undefined {
  if (!item.name) return undefined;
  return {
    id: item.call_id ?? item.id ?? `call_${item.name}`,
    name: item.name,
    arguments: item.arguments ?? '',
  };
}
