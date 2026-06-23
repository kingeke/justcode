import { randomUUID } from 'node:crypto';

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface MessageAttachment {
  path: string;
  content: string;
}

/**
 * A request from the model to invoke a tool. `arguments` is the raw JSON string
 * exactly as the model produced it — parsing/validation is the tool's concern.
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  attachments?: MessageAttachment[];
  /** Set on `assistant` messages that request one or more tool invocations. */
  toolCalls?: ToolCall[];
  /** Set on `tool` messages: the id of the `ToolCall` this result answers. */
  toolCallId?: string;
  /** Set on `tool` messages: the name of the tool that produced this result. */
  name?: string;
  /** Optional assistant thinking text persisted for interrupted responses. */
  thinking?: {
    content: string;
    durationMs: number;
  };
}

export interface CreateMessageExtras {
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  thinking?: {
    content: string;
    durationMs: number;
  };
}

export function createMessage(
  role: MessageRole,
  content: string,
  createdAt = new Date(),
  attachments?: MessageAttachment[],
  extras?: CreateMessageExtras
): ChatMessage {
  return {
    id: randomUUID(),
    role,
    content,
    createdAt: createdAt.toISOString(),
    ...(attachments?.length ? { attachments } : {}),
    ...(extras?.toolCalls?.length ? { toolCalls: extras.toolCalls } : {}),
    ...(extras?.toolCallId ? { toolCallId: extras.toolCallId } : {}),
    ...(extras?.name ? { name: extras.name } : {}),
    ...(extras?.thinking ? { thinking: extras.thinking } : {}),
  };
}

export function renderMessageContentForModel(message: ChatMessage): string {
  if (!message.attachments?.length) {
    return message.content;
  }

  const attachmentsSection = message.attachments
    .map((attachment) =>
      [`File: ${attachment.path}`, '```', attachment.content, '```'].join('\n')
    )
    .join('\n\n');

  return [
    message.content,
    '',
    'Attached file context:',
    attachmentsSection,
  ].join('\n');
}
