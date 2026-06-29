import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WebviewRole } from '@ext/shared/protocol';
import { MessageView } from '@ext/webview/components/MessageView';

describe('MessageView', () => {
  it('renders historical tool results with tool styling and name', () => {
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
  });
});
