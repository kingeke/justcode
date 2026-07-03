import * as React from 'react';

import { WebviewRole, type WebviewMessage } from '@ext/shared/protocol';
import { ChatIcon } from '@ext/webview/components/Icons';
import { formatTime } from '@ext/webview/components/MessageView';

/** How many of the conversation's user messages the hover panel lists. */
export const CONVERSATION_SIDEBAR_LIMIT = 50;

/** Characters kept per preview before it's cut with an ellipsis. */
export const CONVERSATION_PREVIEW_MAX_CHARS = 180;

/** A user message prepared for the sidebar: plain-text preview + sent time. */
export interface ConversationSidebarItem {
  messageId: string;
  preview: string;
  time: string;
}

/**
 * Flattens Markdown to plain text for the sidebar previews: code blocks and
 * formatting markers go away, link/image text is kept, and all whitespace
 * (including newlines) collapses to single spaces.
 */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/(\*\*|__|~~)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Builds the display list for the conversation sidebar: the current session's
 * user messages (most recent `limit`, in conversation order), each flattened to
 * a plain-text preview capped at `maxChars` and ended with an ellipsis when cut.
 * Pure and exported so the filtering/truncation can be unit-tested without a DOM.
 */
export function buildConversationItems(
  messages: WebviewMessage[],
  limit = CONVERSATION_SIDEBAR_LIMIT,
  maxChars = CONVERSATION_PREVIEW_MAX_CHARS
): ConversationSidebarItem[] {
  return messages
    .filter(
      (message) =>
        message.role === WebviewRole.User && message.content.trim() !== ''
    )
    .slice(-limit)
    .map((message) => {
      const text = toPlainText(message.content);
      return {
        messageId: message.id,
        preview:
          text.length > maxChars
            ? `${text.slice(0, maxChars).trimEnd()}…`
            : text,
        time: message.createdAt ? formatTime(message.createdAt) : '',
      };
    });
}

interface ConversationSidebarProps {
  messages: WebviewMessage[];
  /** Scrolls the transcript to the given message. */
  onSelect: (messageId: string) => void;
  /**
   * How many jump-to-top/bottom arrows are currently visible below this button
   * (0–2), so it stacks directly above them as the top button in the group.
   */
  stackedButtons?: number;
}

/**
 * A ChatGPT-style outline of the current conversation, as a round button
 * stacked above the transcript's jump arrows. Hovering it pops up a card
 * listing what the user asked, as truncated plain-text previews. Clicking one
 * scrolls the transcript to that message.
 */
export function ConversationSidebar({
  messages,
  onSelect,
  stackedButtons = 0,
}: ConversationSidebarProps): React.JSX.Element {
  const items = React.useMemo(
    () => buildConversationItems(messages),
    [messages]
  );

  return (
    // Hover (CSS) reveals the panel; moving the mouse away closes it again.
    <div
      className={`conversation-sidebar conversation-sidebar-raised-${stackedButtons}`}
    >
      <button
        type="button"
        className="conversation-sidebar-tab"
        aria-label="Your messages"
        title="Your messages"
      >
        <ChatIcon size={14} />
      </button>

      <div className="conversation-sidebar-panel" role="menu">
        <div className="conversation-sidebar-header">
          <span className="conversation-sidebar-title">Your messages</span>
        </div>

        <div className="conversation-sidebar-list">
          {items.length === 0 ? (
            <div className="conversation-sidebar-empty">No messages yet.</div>
          ) : (
            items.map((item) => (
              <button
                key={item.messageId}
                type="button"
                className="conversation-sidebar-item"
                onClick={(event) => {
                  // Drop focus so the panel doesn't linger once the mouse leaves.
                  event.currentTarget.blur();
                  onSelect(item.messageId);
                }}
              >
                <span className="conversation-sidebar-item-title">
                  {item.preview}
                </span>
                {item.time ? (
                  <span className="conversation-sidebar-item-meta">
                    {item.time}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
