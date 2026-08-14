import * as React from 'react';

import type {
  ApprovalRequestMessage,
  UserInputRequestMessage,
} from '@ext/shared/protocol';
import { DiffView } from '@ext/webview/components/DiffView';
import { renderMarkdown, renderMarkdownInline } from '@ext/webview/markdown';

/** Inline gate shown when a tool needs the user's approval before running. */
export function ApprovalPrompt({
  request,
  onRespond,
  onApproveAll,
}: {
  request: ApprovalRequestMessage;
  onRespond: (approved: boolean) => void;
  /** Approve this tool and turn on auto-approve for the rest of the session. */
  onApproveAll: () => void;
}): React.JSX.Element {
  return (
    <div className="prompt prompt-approval">
      <div className="prompt-head">
        Allow <strong>{request.toolName}</strong>?
      </div>
      <div className="prompt-title">{request.view.title}</div>
      {request.view.preview ? (
        <pre className="tool-preview">{request.view.preview}</pre>
      ) : null}
      {request.view.diff ? <DiffView diff={request.view.diff} /> : null}
      <div className="prompt-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onRespond(true)}
        >
          Approve
        </button>
        <button type="button" className="btn" onClick={() => onRespond(false)}>
          Reject
        </button>
        <button
          type="button"
          className="btn"
          title="Approve this and stop asking — auto-approves all tools for the session"
          onClick={onApproveAll}
        >
          Approve all tools
        </button>
      </div>
    </div>
  );
}

/** Inline free-text question a tool asked mid-turn. */
export function InputPrompt({
  request,
  onRespond,
}: {
  request: UserInputRequestMessage;
  onRespond: (value: string) => void;
}): React.JSX.Element {
  const [value, setValue] = React.useState('');

  const submit = (text: string): void => {
    const trimmed = text.trim();
    if (trimmed) onRespond(trimmed);
  };

  return (
    <div className="prompt prompt-input">
      {/* Questions are authored as Markdown (code spans, lists, emphasis), so
          render them like assistant text instead of showing the raw source. */}
      <div
        className="prompt-head markdown-body"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(request.question) }}
      />
      {request.options && request.options.length > 0 ? (
        <ol className="prompt-options">
          {request.options.map((option, index) => (
            <li key={option}>
              <button
                type="button"
                className="btn prompt-option"
                onClick={() => onRespond(option)}
              >
                <span className="prompt-option-number">{index + 1}.</span>
                <span
                  className="prompt-option-label markdown-body"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdownInline(option),
                  }}
                />
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      <form
        className="prompt-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit(value);
        }}
      >
        <input
          className="prompt-text"
          value={value}
          autoFocus
          onChange={(event) => setValue(event.target.value)}
          placeholder="Type your answer…"
        />
        <button type="submit" className="btn btn-primary">
          Send
        </button>
      </form>
    </div>
  );
}
