import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WebviewRole } from '@ext/shared/protocol';
import { MessageView } from '@ext/webview/components/MessageView';

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
