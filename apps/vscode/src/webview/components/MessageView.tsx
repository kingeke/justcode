import * as React from 'react';

import { WebviewRole, type WebviewMessage } from '@ext/shared/protocol';

export function MessageView({
  message,
}: {
  message: WebviewMessage;
}): React.JSX.Element {
  if (message.role === WebviewRole.Tool) {
    return (
      <div className="msg msg-tool">
        <pre className="msg-content">{message.content}</pre>
      </div>
    );
  }

  return (
    <div className={`msg msg-${message.role}`}>
      <pre className="msg-content">{message.content}</pre>
    </div>
  );
}
