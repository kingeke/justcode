import {
  renderMessageContentForModel,
  type ChatMessage,
  type ToolCall,
} from '@core/domain/message';
import type { ToolDefinition } from '@core/ports/tool';

/**
 * Translation helpers between justcode's domain messages/tools and Anthropic's
 * Messages API wire format. Unlike the OpenAI-compatible providers, Anthropic
 * keeps the system prompt out of the message list and represents tool calls and
 * their results as typed content blocks.
 */

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

export interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

export interface AnthropicWireMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}

export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicWireRequest {
  system: string | undefined;
  messages: AnthropicWireMessage[];
}

/**
 * Splits domain messages into Anthropic's top-level `system` string and an
 * alternating user/assistant message list. Consecutive same-role messages are
 * merged into a single message (the API rejects consecutive turns of the same
 * role), and `tool` messages become `tool_result` blocks on a user turn.
 */
export function toAnthropicWireRequest(
  messages: ChatMessage[]
): AnthropicWireRequest {
  const systemParts: string[] = [];
  const wire: AnthropicWireMessage[] = [];

  const push = (role: 'user' | 'assistant', blocks: AnthropicContentBlock[]) => {
    if (blocks.length === 0) return;
    const last = wire[wire.length - 1];
    if (last && last.role === role) {
      last.content.push(...blocks);
      return;
    }
    wire.push({ role, content: blocks });
  };

  for (const message of messages) {
    if (message.role === 'system') {
      if (message.content.trim()) systemParts.push(message.content);
      continue;
    }

    if (message.role === 'tool') {
      push('user', [
        {
          type: 'tool_result',
          tool_use_id: message.toolCallId ?? '',
          content: message.content,
        },
      ]);
      continue;
    }

    if (message.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = [];
      if (message.content.trim()) {
        blocks.push({ type: 'text', text: message.content });
      }
      for (const call of message.toolCalls ?? []) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: parseToolInput(call.arguments),
        });
      }
      push('assistant', blocks);
      continue;
    }

    // user
    push('user', [
      { type: 'text', text: renderMessageContentForModel(message) },
    ]);
  }

  return {
    system: systemParts.length ? systemParts.join('\n\n') : undefined,
    messages: wire,
  };
}

export function toAnthropicToolDefinitions(
  tools: ToolDefinition[] | undefined
): AnthropicToolDefinition[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}

/** Maps Anthropic `tool_use` content blocks from a response into domain calls. */
export function parseAnthropicToolCalls(
  blocks: Array<{ type?: string; id?: string; name?: string; input?: unknown }>
): ToolCall[] {
  return blocks
    .filter((block) => block.type === 'tool_use')
    .map((block, index) => ({
      id: block.id ?? `call_${index}`,
      name: block.name ?? '',
      arguments: JSON.stringify(block.input ?? {}),
    }))
    .filter((call) => call.name);
}

function parseToolInput(rawArguments: string): unknown {
  const trimmed = rawArguments.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    // The model occasionally emits not-quite-JSON; pass it through as a string
    // so the request still carries the intent rather than failing outright.
    return trimmed;
  }
}
