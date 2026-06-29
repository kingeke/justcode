import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { ToolActivityView } from '@ext/webview/components/ToolActivityView';

describe('ToolActivityView', () => {
  it('uses single-line ellipsis styling for tool titles', () => {
    const stylesheet = readFileSync(
      'apps/vscode/src/webview/webview.css',
      'utf8'
    );

    expect(stylesheet).toContain('.tool-title');
    expect(stylesheet).toContain('white-space: nowrap;');
    expect(stylesheet).toContain('overflow: hidden;');
    expect(stylesheet).toContain('text-overflow: ellipsis;');
    expect(stylesheet).toContain('min-width: 0;');
  });

  it('renders input preview only for whitelisted tools and changes for edit tools', () => {
    const markup = renderToStaticMarkup(
      <ToolActivityView
        expandTools={true}
        tools={[
          {
            toolCallId: 'tool-1',
            toolName: 'bash',
            view: {
              title: 'bash: ls',
              preview: 'ls -la',
            },
            done: true,
            isError: false,
            resultPreview: 'file-a\nfile-b',
          },
          {
            toolCallId: 'tool-2',
            toolName: 'read_file',
            view: {
              title: 'read README',
              preview: 'README.md',
            },
            done: true,
            isError: false,
            resultPreview: 'README contents',
          },
          {
            toolCallId: 'tool-3',
            toolName: 'write_file',
            view: {
              title: 'write README.md',
              preview: '# README',
              diff: {
                path: 'README.md',
                oldText: '',
                newText: '# README',
              },
            },
            done: true,
            isError: false,
            resultPreview: 'Wrote README.md (1 lines).',
          },
        ]}
      />
    );

    expect(markup).toContain('ls -la');
    expect(markup).not.toContain(
      'read README</span><div class="tool-section-label">Input</div>'
    );
    expect(markup).toContain('file-a');
    expect(markup).toContain('README contents');
    expect(markup).toContain('write README.md');
    expect(markup).toContain('diff-line diff-added');
    expect(markup).toContain('Wrote README.md (1 lines).');
    expect(markup).not.toContain('<pre class="tool-preview"># README</pre>');
  });
});
