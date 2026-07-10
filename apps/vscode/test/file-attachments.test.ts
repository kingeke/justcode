import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createConversation } from '@core/domain/conversation';
import { createMessage, MessageRole } from '@core/domain/message';
import {
  materializeFileAttachments,
  toWebviewMessages,
} from '@ext/host/chat-bridge';
import { FileEncoding } from '@ext/shared/protocol';

describe('materializeFileAttachments', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'justcode-attach-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('attaches text files inline', async () => {
    const attachments = await materializeFileAttachments(
      [{ id: 'f1', name: 'notes.txt', content: 'hello world' }],
      directory
    );

    expect(attachments).toEqual([
      { path: 'notes.txt', content: 'hello world' },
    ]);
  });

  it('writes binary files to disk and attaches the path for tool access', async () => {
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]);
    const attachments = await materializeFileAttachments(
      [
        {
          id: 'f1',
          name: 'passport.pdf',
          content: bytes.toString('base64'),
          encoding: FileEncoding.Base64,
          mediaType: 'application/pdf',
        },
      ],
      directory
    );

    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.path).toBe('passport.pdf');
    expect(attachments[0]?.content).toContain('application/pdf');
    expect(attachments[0]?.content).toContain('Use your tools');
    // The note names the saved path; the file on disk holds the exact bytes.
    const savedPath = /saved to (\S+)\)/.exec(attachments[0]!.content)?.[1];
    expect(savedPath).toBeDefined();
    expect(await readFile(savedPath!)).toEqual(bytes);
  });

  it('never lets a hostile name escape the attachments directory', async () => {
    const attachments = await materializeFileAttachments(
      [
        {
          id: 'f1',
          name: '../../escape.bin',
          content: Buffer.from('x').toString('base64'),
          encoding: FileEncoding.Base64,
        },
      ],
      directory
    );

    const savedPath = /saved to (\S+)\)/.exec(attachments[0]!.content)?.[1];
    expect(savedPath).toBeDefined();
    expect(savedPath!.startsWith(directory)).toBe(true);
  });
});

describe('transcript attachment chips', () => {
  it('exposes user message attachment names to the webview', async () => {
    const conversation = createConversation('s1');
    conversation.messages.push(
      createMessage(MessageRole.User, 'analyze this', new Date(), [
        { path: 'Chinonso Eke CV.pdf', content: '(binary file…)' },
      ])
    );

    const messages = await toWebviewMessages(conversation);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.attachments).toEqual(['Chinonso Eke CV.pdf']);
  });
});
