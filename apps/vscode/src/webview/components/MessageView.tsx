import * as React from 'react';

import { WebviewRole, type WebviewMessage } from '@ext/shared/protocol';
import { renderMarkdown } from '@ext/webview/markdown';

export function MessageView({
  message,
  expandTools = false,
}: {
  message: WebviewMessage;
  expandTools?: boolean;
}): React.JSX.Element {
  if (message.role === WebviewRole.Tool) {
    return (
      <div className="tools tools-history">
        <div className="tool tool-done">
          <div className="tool-head">
            <span className="tool-status">✓</span>
            <span className="tool-title">Tool result</span>
            {message.toolName ? (
              <span className="tool-name">{message.toolName}</span>
            ) : null}
          </div>
          {expandTools ? (
            <pre className="tool-result">{message.content}</pre>
          ) : null}
        </div>
      </div>
    );
  }

  // Assistant replies are Markdown; render them. User/system text is shown
  // verbatim so what the user typed isn't reflowed or reinterpreted.
  if (message.role === WebviewRole.Assistant) {
    return (
      <div className="msg msg-assistant">
        <div
          className="msg-content markdown-body"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
        />
      </div>
    );
  }

  return (
    <div className={`msg msg-${message.role}`}>
      <pre className="msg-content">{message.content}</pre>
    </div>
  );
}
