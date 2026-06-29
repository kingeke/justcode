import * as React from 'react';

import type { ToolActivity } from '@ext/webview/state';
import { DiffView } from '@ext/webview/components/DiffView';

const TOOL_INPUT_PREVIEW_NAMES = new Set(['grep', 'glob', 'bash']);
const TOOL_CHANGE_PREVIEW_NAMES = new Set([
  'apply_patch',
  'edit_file',
  'write_file',
]);

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
          {expandTools &&
          tool.view.preview &&
          TOOL_INPUT_PREVIEW_NAMES.has(tool.toolName) ? (
            <>
              <div className="tool-section-label">Input</div>
              <pre className="tool-preview">{tool.view.preview}</pre>
            </>
          ) : null}
          {expandTools &&
          tool.view.diff &&
          TOOL_CHANGE_PREVIEW_NAMES.has(tool.toolName) ? (
            <>
              <div className="tool-section-label">Changes</div>
              <DiffView diff={tool.view.diff} />
            </>
          ) : null}
          {expandTools && tool.done && tool.resultPreview ? (
            <>
              <div className="tool-section-label">Result</div>
              <pre className="tool-result">{tool.resultPreview}</pre>
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
}
