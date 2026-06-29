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
});
