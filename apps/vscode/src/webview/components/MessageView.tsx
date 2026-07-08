import * as React from 'react';

import { WebviewRole, type WebviewMessage } from '@ext/shared/protocol';
import { DiffView } from '@ext/webview/components/DiffView';
import {
  CheckIcon,
  CopyIcon,
  FileIcon,
  PencilIcon,
  RefreshIcon,
} from '@ext/webview/components/Icons';
import { ToolTitle } from '@ext/webview/components/ToolTitle';
import { renderMarkdown } from '@ext/webview/markdown';

/** Formats an ISO date as a local hour:minute time, or '' when unparsable. */
export function formatTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

const TOOL_INPUT_PREVIEW_NAMES = new Set(['grep', 'glob', 'bash']);
const TOOL_CHANGE_PREVIEW_NAMES = new Set([
  'apply_patch',
  'edit_file',
  'write_file',
]);

interface MessageViewProps {
  message: WebviewMessage;
  expandTools?: boolean;
  onOpenFile?: (path: string) => void;
  /** Opens a full-size preview of a transcript image (data URL). */
  onOpenImage?: (src: string) => void;
  /**
   * Re-sends this user message, scrapping it and every message after it.
   * Only passed for retryable user messages (idle, current epoch).
   */
  onRetry?: () => void;
  /**
   * Opens an inline composer to edit this user message and re-send it,
   * scrapping it and every message after it. Passed under the same conditions
   * as {@link onRetry}.
   */
  onEdit?: () => void;
  /** DOM id for the message's root element, so the sidebar can scroll to it. */
  domId?: string;
}

function MessageViewImpl({
  message,
  expandTools = false,
  onOpenFile,
  onOpenImage,
  onRetry,
  onEdit,
  domId,
}: {
  message: WebviewMessage;
  expandTools?: boolean;
  onOpenFile?: (path: string) => void;
  /** Opens a full-size preview of a transcript image (data URL). */
  onOpenImage?: (src: string) => void;
  /**
   * Re-sends this user message, scrapping it and every message after it.
   * Only passed for retryable user messages (idle, current epoch).
   */
  onRetry?: () => void;
  /**
   * Opens an inline composer to edit this user message and re-send it,
   * scrapping it and every message after it. Passed under the same conditions
   * as {@link onRetry}.
   */
  onEdit?: () => void;
  /** DOM id for the message's root element, so the sidebar can scroll to it. */
  domId?: string;
}): React.JSX.Element {
  // Copy-to-clipboard feedback for the user/assistant copy buttons. Copies the
  // raw message text (assistant replies: the Markdown source, not rendered
  // HTML). Declared before the role branches so the hook runs unconditionally.
  const [copied, setCopied] = React.useState(false);
  const copyContent = (): void => {
    void navigator.clipboard?.writeText(message.content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  // A compaction summary opens a new epoch. It renders exactly like a
  // collapsed thinking block — it's carried-over context the model works
  // from, not something the user typed.
  if (message.isCompactSummary) {
    const compactedAt = message.createdAt ? formatTime(message.createdAt) : '';
    return (
      <div id={domId} className="msg msg-compact-summary">
        <details className="thinking thinking-done">
          <summary className="thinking-label">
            Conversation compacted
            {compactedAt ? ` at ${compactedAt}` : ''} — summary sent to the
            model
          </summary>
          <div
            className="thinking-content markdown-body"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(message.content),
            }}
          />
        </details>
      </div>
    );
  }

  if (message.role === WebviewRole.Tool) {
    const isError = message.toolView?.isError === true;
    return (
      <div id={domId} className="tools tools-history">
        <div className={`tool tool-done ${isError ? 'tool-error' : ''}`}>
          <div className="tool-head">
            <span className="tool-status">{isError ? '✗' : '✓'}</span>
            <ToolTitle
              title={message.toolView?.title ?? 'Tool result'}
              path={message.toolView?.path}
              onOpenFile={onOpenFile}
            />
            {message.toolName ? (
              <span className="tool-name">{message.toolName}</span>
            ) : null}
          </div>
          {expandTools &&
          message.toolView?.preview &&
          message.toolName &&
          TOOL_INPUT_PREVIEW_NAMES.has(message.toolName) ? (
            <>
              <div className="tool-section-label">Input</div>
              <pre className="tool-preview">{message.toolView.preview}</pre>
            </>
          ) : null}
          {expandTools &&
          message.toolView?.diff &&
          message.toolName &&
          TOOL_CHANGE_PREVIEW_NAMES.has(message.toolName) ? (
            <>
              <div className="tool-section-label">Changes</div>
              <DiffView diff={message.toolView.diff} />
            </>
          ) : null}
          {expandTools ? (
            <>
              <div className="tool-section-label">Result</div>
              <pre className="tool-result">{message.content}</pre>
            </>
          ) : null}
        </div>
      </div>
    );
  }

  // Assistant replies are Markdown; render them. User/system text is shown
  // verbatim so what the user typed isn't reflowed or reinterpreted.
  if (message.role === WebviewRole.Assistant) {
    // When the LLM received the request that produced this reply.
    const assistantTiming = message.llmReceivedAt
      ? formatTime(message.llmReceivedAt)
      : '';
    return (
      <div id={domId} className="msg msg-assistant">
        <div
          className="msg-content markdown-body"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
        />
        <div className="msg-footer">
          {assistantTiming ? (
            <div className="msg-time">{assistantTiming}</div>
          ) : null}
          {message.content ? (
            <button
              type="button"
              className="msg-copy-btn"
              title={copied ? 'Copied' : 'Copy response as Markdown'}
              onClick={copyContent}
            >
              {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const timing =
    message.role === WebviewRole.User && message.createdAt
      ? formatTime(message.createdAt)
      : '';

  return (
    <div id={domId} className={`msg msg-${message.role}`}>
      <div className="msg-body">
        {message.attachments?.length ? (
          <div className="msg-attachments">
            {message.attachments.map((name, index) => (
              <span key={index} className="msg-attachment" title={name}>
                <FileIcon size={13} />
                <span className="msg-attachment-name">{name}</span>
              </span>
            ))}
          </div>
        ) : null}
        {message.images?.length ? (
          <div className="msg-images">
            {message.images.map((image, index) => {
              const src = `data:${image.mediaType};base64,${image.data}`;
              return (
                <button
                  key={index}
                  type="button"
                  className="msg-image-btn"
                  title="Click to preview"
                  onClick={() => onOpenImage?.(src)}
                >
                  <img className="msg-image" src={src} alt="Attached image" />
                </button>
              );
            })}
          </div>
        ) : null}
        {message.content ? (
          <pre className="msg-content">{message.content}</pre>
        ) : null}
        {timing ||
        onRetry ||
        onEdit ||
        (message.role === WebviewRole.User && message.content) ? (
          <div className="msg-footer">
            {message.role === WebviewRole.User && message.content ? (
              <button
                type="button"
                className="msg-copy-btn"
                title={copied ? 'Copied' : 'Copy prompt'}
                onClick={copyContent}
              >
                {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
              </button>
            ) : null}
            {onEdit ? (
              <button
                type="button"
                className="msg-copy-btn msg-edit-btn"
                title="Edit and re-send from here (discards everything after this message)"
                onClick={onEdit}
              >
                <PencilIcon size={13} />
              </button>
            ) : null}
            {onRetry ? (
              <button
                type="button"
                className="msg-copy-btn msg-retry-btn"
                title="Retry from here (discards everything after this message)"
                onClick={onRetry}
              >
                <RefreshIcon size={13} />
              </button>
            ) : null}
            {timing ? <div className="msg-time">{timing}</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Memoized: the transcript re-renders on every streamed token and local state
 * change, so with long conversations re-rendering a thousand committed
 * messages per token dominates the frame. Committed message objects are stable
 * between snapshots, so a reference compare skips them. Handler *identity* is
 * deliberately ignored — App recreates the closures each render but their
 * behavior only depends on the (compared) message and stable dispatchers — so
 * only their presence (retry/edit offered or not) forces a re-render.
 */
export const MessageView = React.memo(
  MessageViewImpl,
  (prev: MessageViewProps, next: MessageViewProps) =>
    prev.message === next.message &&
    prev.expandTools === next.expandTools &&
    prev.domId === next.domId &&
    Boolean(prev.onRetry) === Boolean(next.onRetry) &&
    Boolean(prev.onEdit) === Boolean(next.onEdit) &&
    Boolean(prev.onOpenFile) === Boolean(next.onOpenFile) &&
    Boolean(prev.onOpenImage) === Boolean(next.onOpenImage)
);
