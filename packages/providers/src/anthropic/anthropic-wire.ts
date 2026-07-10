import {
  MessageRole,
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

export enum AnthropicBlockType {
  Text = 'text',
  ToolUse = 'tool_use',
  ToolResult = 'tool_result',
  Image = 'image',
}

export enum AnthropicDeltaType {
  TextDelta = 'text_delta',
  ThinkingDelta = 'thinking_delta',
  InputJsonDelta = 'input_json_delta',
}

export interface AnthropicTextBlock {
  type: AnthropicBlockType.Text;
  text: string;
}

export interface AnthropicToolUseBlock {
  type: AnthropicBlockType.ToolUse;
  id: string;
  name: string;
  input: unknown;
}

export interface AnthropicToolResultBlock {
  type: AnthropicBlockType.ToolResult;
  tool_use_id: string;
  content: string;
}

export interface AnthropicImageBlock {
  type: AnthropicBlockType.Image;
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | AnthropicImageBlock;

export interface AnthropicWireMessage {
  role: MessageRole;
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

  const push = (role: MessageRole, blocks: AnthropicContentBlock[]) => {
    if (blocks.length === 0) return;
    const last = wire[wire.length - 1];
    if (last && last.role === role) {
      last.content.push(...blocks);
      return;
    }
    wire.push({ role, content: blocks });
  };

  for (const message of messages) {
    if (message.role === MessageRole.System) {
      if (message.content.trim()) systemParts.push(message.content);
      continue;
    }

    if (message.role === MessageRole.Tool) {
      push(MessageRole.User, [
        {
          type: AnthropicBlockType.ToolResult,
          tool_use_id: message.toolCallId ?? '',
          content: message.content,
        },
      ]);
      continue;
    }

    if (message.role === MessageRole.Assistant) {
      const blocks: AnthropicContentBlock[] = [];
      if (message.content.trim()) {
        blocks.push({ type: AnthropicBlockType.Text, text: message.content });
      }
      for (const call of message.toolCalls ?? []) {
        blocks.push({
          type: AnthropicBlockType.ToolUse,
          id: call.id,
          name: call.name,
          input: parseToolInput(call.arguments),
        });
      }
      push(MessageRole.Assistant, blocks);
      continue;
    }

    // user: images first (so the model has them in view), then the prose.
    const userBlocks: AnthropicContentBlock[] = [];
    for (const image of message.images ?? []) {
      userBlocks.push({
        type: AnthropicBlockType.Image,
        source: {
          type: 'base64',
          media_type: image.mediaType,
          data: image.data,
        },
      });
    }
    // Skip an empty text block (image-only message) — the API rejects it.
    const userText = renderMessageContentForModel(message);
    if (userText.trim() || userBlocks.length === 0) {
      userBlocks.push({ type: AnthropicBlockType.Text, text: userText });
    }
    push(MessageRole.User, userBlocks);
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
    .filter((block) => block.type === AnthropicBlockType.ToolUse)
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
