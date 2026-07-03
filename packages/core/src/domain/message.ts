import { randomUUID } from 'node:crypto';

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface MessageAttachment {
  path: string;
  content: string;
}

/**
 * An image attached to a user message (e.g. pasted from the clipboard), carried
 * to the model as a base64 content block. `mediaType` is the image's MIME type
 * (e.g. `image/png`); `data` is its base64-encoded bytes (no data: URI prefix).
 */
export interface MessageImage {
  mediaType: string;
  data: string;
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
  /**
   * When the LLM received the request, as an ISO timestamp. Set on `user`
   * messages the first time they are dispatched to the model, and on
   * `assistant` messages to record when the model received the request that
   * produced the reply.
   */
  llmReceivedAt?: string;
  attachments?: MessageAttachment[];
  /** Images attached to a `user` message, sent to the model as image blocks. */
  images?: MessageImage[];
  /** Set on `assistant` messages that request one or more tool invocations. */
  toolCalls?: ToolCall[];
  /** Set on `tool` messages: the id of the `ToolCall` this result answers. */
  toolCallId?: string;
  /** Set on `tool` messages: the name of the tool that produced this result. */
  name?: string;
  /** Set on `tool` messages whose call was rejected, failed, or interrupted. */
  isError?: boolean;
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
  isError?: boolean;
  images?: MessageImage[];
  thinking?: {
    content: string;
    durationMs: number;
  };
  /** For `assistant` messages: when the LLM received the producing request. */
  llmReceivedAt?: string;
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
    ...(extras?.images?.length ? { images: extras.images } : {}),
    ...(extras?.toolCalls?.length ? { toolCalls: extras.toolCalls } : {}),
    ...(extras?.toolCallId ? { toolCallId: extras.toolCallId } : {}),
    ...(extras?.name ? { name: extras.name } : {}),
    ...(extras?.isError ? { isError: true } : {}),
    ...(extras?.thinking ? { thinking: extras.thinking } : {}),
    ...(extras?.llmReceivedAt ? { llmReceivedAt: extras.llmReceivedAt } : {}),
  };
}

/**
 * Stamps `llmReceivedAt` on every `user` message that hasn't been dispatched to
 * the model yet. Called right before a provider request with the messages that
 * request carries, so the timestamp records when the LLM first received them.
 * Messages already stamped (earlier steps of the same turn, prior turns) are
 * left untouched.
 */
export function markLlmReceived(
  messages: ChatMessage[],
  receivedAt = new Date()
): void {
  for (const message of messages) {
    if (message.role === 'user' && !message.llmReceivedAt) {
      message.llmReceivedAt = receivedAt.toISOString();
    }
  }
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
