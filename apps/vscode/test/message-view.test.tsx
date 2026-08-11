import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WebviewRole } from '@ext/shared/protocol';
import { MessageView, formatTime } from '@ext/webview/components/MessageView';

describe('MessageView', () => {
  it('renders collapsed historical tool results with tool styling and name by default', () => {
    const markup = renderToStaticMarkup(
      <MessageView
        message={{
          id: 'tool-1',
          role: WebviewRole.Tool,
          content: 'README.md lines 1-10',
          toolName: 'read_file',
        }}
      />
    );

    expect(markup).toContain('tools tools-history');
    expect(markup).toContain('tool tool-done');
    expect(markup).toContain('tool-name');
    expect(markup).toContain('read_file');
    expect(markup).toContain('Tool result');
    expect(markup).not.toContain('tool-result');
    expect(markup).not.toContain('README.md lines 1-10');
  });

  it('renders expanded historical tool results when expandTools is enabled', () => {
    const markup = renderToStaticMarkup(
      <MessageView
        expandTools={true}
        message={{
          id: 'tool-1',
          role: WebviewRole.Tool,
          content: 'README.md lines 1-10',
          toolName: 'read_file',
        }}
      />
    );

    expect(markup).toContain('tool-result');
    expect(markup).toContain('README.md lines 1-10');
  });

  it('renders change diff and hides input preview for historical edit tools', () => {
    const markup = renderToStaticMarkup(
      <MessageView
        expandTools={true}
        message={{
          id: 'tool-2',
          role: WebviewRole.Tool,
          content: 'Edited README.md (1 occurrence replaced).',
          toolName: 'edit_file',
          toolView: {
            title: 'edit README.md',
            preview: 'old\n→\nnew',
            diff: {
              path: 'README.md',
              oldText: 'old',
              newText: 'new',
            },
          },
        }}
      />
    );

    expect(markup).toContain('edit README.md');
    expect(markup).not.toContain(`old
→
new`);
    expect(markup).toContain('diff-line diff-added');
    expect(markup).toContain('Edited README.md (1 occurrence replaced).');
  });

  it('renders image thumbnails on a user message', () => {
    const markup = renderToStaticMarkup(
      <MessageView
        message={{
          id: 'u1',
          role: WebviewRole.User,
          content: 'look at this',
          images: [{ mediaType: 'image/png', data: 'AAAA' }],
        }}
      />
    );

    expect(markup).toContain('msg-image');
    expect(markup).toContain('data:image/png;base64,AAAA');
    expect(markup).toContain('look at this');
  });

  it('renders an image-only user message without an empty text block', () => {
    const markup = renderToStaticMarkup(
      <MessageView
        message={{
          id: 'u2',
          role: WebviewRole.User,
          content: '',
          images: [{ mediaType: 'image/png', data: 'BBBB' }],
        }}
      />
    );

    expect(markup).toContain('data:image/png;base64,BBBB');
    expect(markup).not.toContain('msg-content');
  });

  it('renders the sent hour:minute under a user message', () => {
    const createdAt = '2026-07-02T10:15:30.000Z';
    const markup = renderToStaticMarkup(
      <MessageView
        message={{
          id: 'u3',
          role: WebviewRole.User,
          content: 'hello',
          createdAt,
          llmReceivedAt: '2026-07-02T10:15:31.000Z',
        }}
      />
    );

    expect(markup).toContain('msg-time');
    expect(markup).toContain(formatTime(createdAt));
    // The LLM-received time renders under the assistant reply, not here.
    expect(markup).not.toContain('Received');
  });

  it('omits the timestamp footer when a user message has no timestamp', () => {
    const markup = renderToStaticMarkup(
      <MessageView
        message={{
          id: 'u5',
          role: WebviewRole.User,
          content: 'hello',
        }}
      />
    );

    expect(markup).not.toContain('msg-time');
  });

  it('renders the LLM-received time under an assistant message', () => {
    const llmReceivedAt = '2026-07-02T10:15:31.000Z';
    const markup = renderToStaticMarkup(
      <MessageView
        message={{
          id: 'a1',
          role: WebviewRole.Assistant,
          content: 'hi there',
          createdAt: '2026-07-02T10:15:35.000Z',
          llmReceivedAt,
        }}
      />
    );

    expect(markup).toContain('msg-time');
    expect(markup).toContain(formatTime(llmReceivedAt));
  });

  it('omits the assistant footer when no LLM-received time is present', () => {
    const markup = renderToStaticMarkup(
      <MessageView
        message={{
          id: 'a2',
          role: WebviewRole.Assistant,
          content: 'hi there',
          createdAt: '2026-07-02T10:15:35.000Z',
        }}
      />
    );

    expect(markup).not.toContain('msg-time');
  });

  it('renders a retry button on a user message when onRetry is provided', () => {
    const markup = renderToStaticMarkup(
      <MessageView
        message={{
          id: 'u6',
          role: WebviewRole.User,
          content: 'hello',
        }}
        onRetry={() => {}}
      />
    );

    expect(markup).toContain('msg-retry-btn');
    expect(markup).toContain('Retry from here');
  });

  it('renders an edit button on a user message when onEdit is provided', () => {
    const markup = renderToStaticMarkup(
      <MessageView
        message={{
          id: 'u8',
          role: WebviewRole.User,
          content: 'hello',
        }}
        onEdit={() => {}}
      />
    );

    expect(markup).toContain('msg-edit-btn');
    expect(markup).toContain('Edit and re-send from here');
  });

  it('omits the retry button when onRetry is not provided', () => {
    const markup = renderToStaticMarkup(
      <MessageView
        message={{
          id: 'u7',
          role: WebviewRole.User,
          content: 'hello',
        }}
      />
    );

    expect(markup).not.toContain('msg-retry-btn');
  });

  it('renders user message content as markdown', () => {
    const markup = renderToStaticMarkup(
      <MessageView
        message={{
          id: 'u-md',
          role: WebviewRole.User,
          content: '**bold** text',
        }}
      />
    );

    expect(markup).toContain('msg-content markdown-body');
    expect(markup).toContain('<strong>bold</strong>');
    expect(markup).not.toContain('<pre class="msg-content">');
  });

  it('renders a task tool result as markdown', () => {
    const markup = renderToStaticMarkup(
      <MessageView
        expandTools={true}
        message={{
          id: 'tool-task',
          role: WebviewRole.Tool,
          content: '## Report\n**done**',
          toolName: 'task',
        }}
      />
    );

    expect(markup).toContain('markdown-body');
    expect(markup).toContain('<strong>done</strong>');
    expect(markup).not.toContain('tool-result');
  });

  it('renders a copy button on a compaction summary', () => {
    const markup = renderToStaticMarkup(
      <MessageView
        message={{
          id: 'c1',
          role: WebviewRole.Assistant,
          content: '## Summary\nwhat happened so far',
          isCompactSummary: true,
        }}
      />
    );

    expect(markup).toContain('msg-compact-summary');
    expect(markup).toContain('msg-compact-copy-btn');
    expect(markup).toContain('Copy summary as Markdown');
  });

  it('omits the compaction summary copy button when there is no content', () => {
    const markup = renderToStaticMarkup(
      <MessageView
        message={{
          id: 'c2',
          role: WebviewRole.Assistant,
          content: '',
          isCompactSummary: true,
        }}
      />
    );

    expect(markup).toContain('msg-compact-summary');
    expect(markup).not.toContain('msg-compact-copy-btn');
  });

  it('renders input preview for whitelisted historical tools', () => {
    const markup = renderToStaticMarkup(
      <MessageView
        expandTools={true}
        message={{
          id: 'tool-3',
          role: WebviewRole.Tool,
          content: 'Found 1 matching line.',
          toolName: 'grep',
          toolView: {
            title: 'grep README',
            preview: 'pattern: README',
          },
        }}
      />
    );

    expect(markup).toContain('Input');
    expect(markup).toContain('pattern: README');
    expect(markup).toContain('Found 1 matching line.');
  });
});
