import { randomUUID } from 'node:crypto';

export type MessageRole = 'system' | 'user' | 'assistant';

export interface MessageAttachment {
  path: string;
  content: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  attachments?: MessageAttachment[];
}

export function createMessage(
  role: MessageRole,
  content: string,
  createdAt = new Date(),
  attachments?: MessageAttachment[]
): ChatMessage {
  return {
    id: randomUUID(),
    role,
    content,
    createdAt: createdAt.toISOString(),
    ...(attachments?.length ? { attachments } : {}),
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
