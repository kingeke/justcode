import * as React from 'react';

import type { ToolActivity } from '@ext/webview/state';
import { DiffView } from '@ext/webview/components/DiffView';

/** Live (or completed) tool calls for the current turn. */
export function ToolActivityView({
  tools,
  expandTools = false,
}: {
  tools: ToolActivity[];
  expandTools?: boolean;
}): React.JSX.Element | null {
  if (tools.length === 0) return null;

  return (
    <div className="tools">
      {tools.map((tool) => (
        <div
          key={tool.toolCallId}
          className={`tool ${tool.done ? 'tool-done' : 'tool-running'} ${
            tool.isError ? 'tool-error' : ''
          }`}
        >
          <div className="tool-head">
            <span className="tool-status">
              {tool.done ? (tool.isError ? '✗' : '✓') : '…'}
            </span>
            <span className="tool-title">{tool.view.title}</span>
            <span className="tool-name">{tool.toolName}</span>
          </div>
          {expandTools && tool.view.preview ? (
            <pre className="tool-preview">{tool.view.preview}</pre>
          ) : null}
          {expandTools && tool.view.diff ? (
            <DiffView diff={tool.view.diff} />
          ) : null}
          {expandTools && tool.done && tool.resultPreview ? (
            <pre className="tool-result">{tool.resultPreview}</pre>
          ) : null}
        </div>
      ))}
    </div>
  );
}
