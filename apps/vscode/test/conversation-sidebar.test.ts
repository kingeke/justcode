import { describe, expect, it } from 'vitest';

import { WebviewRole, type WebviewMessage } from '@ext/shared/protocol';
import {
  buildConversationItems,
  CONVERSATION_PREVIEW_MAX_CHARS,
  CONVERSATION_SIDEBAR_LIMIT,
  mergeSidebarMessages,
  toPlainText,
} from '@ext/webview/components/ConversationSidebar';
import {
  LiveTurnItemKind,
  LocalActionType,
  initialState,
  reducer,
} from '@ext/webview/state';

function message(
  id: string,
  role: WebviewRole,
  content: string,
  fields: Partial<WebviewMessage> = {}
): WebviewMessage {
  return { id, role, content, ...fields };
}

describe('toPlainText', () => {
  it('strips markdown formatting down to plain text', () => {
    expect(
      toPlainText('# Heading\n\nSome **bold** and `inline code` here')
    ).toBe('Heading Some bold and inline code here');
  });

  it('drops fenced code blocks and keeps link text', () => {
    expect(
      toPlainText(
        'fix this\n```ts\nconst x = 1;\n```\nsee [the docs](https://x.dev)'
      )
    ).toBe('fix this see the docs');
  });

  it('collapses newlines and list markers into single-spaced text', () => {
    expect(toPlainText('- one\n- two\n\n> quoted')).toBe('one two quoted');
  });
});

describe('buildConversationItems', () => {
  it('lists only user messages, latest first', () => {
    const items = buildConversationItems([
      message('u1', WebviewRole.User, 'first question'),
      message('a1', WebviewRole.Assistant, 'an answer'),
      message('t1', WebviewRole.Tool, 'tool output', { toolName: 'bash' }),
      message('u2', WebviewRole.User, 'second question'),
    ]);

    expect(items.map((i) => i.messageId)).toEqual(['u2', 'u1']);
    expect(items.map((i) => i.preview)).toEqual([
      'second question',
      'first question',
    ]);
  });

  it('skips user messages with no text (e.g. image-only)', () => {
    const items = buildConversationItems([
      message('u1', WebviewRole.User, '   '),
      message('u2', WebviewRole.User, 'real text'),
    ]);
    expect(items.map((i) => i.messageId)).toEqual(['u2']);
  });

  it('truncates long previews with an ellipsis', () => {
    const long = 'word '.repeat(100);
    const [item] = buildConversationItems([
      message('u1', WebviewRole.User, long),
    ]);

    expect(item?.preview.endsWith('…')).toBe(true);
    expect(item?.preview.length).toBeLessThanOrEqual(
      CONVERSATION_PREVIEW_MAX_CHARS + 1
    );
  });

  it('renders previews as plain text, not markdown', () => {
    const [item] = buildConversationItems([
      message('u1', WebviewRole.User, '## Fix\n\n`foo()` is **broken**'),
    ]);
    expect(item?.preview).toBe('Fix foo() is broken');
  });

  it('keeps only the most recent messages up to the limit, latest first', () => {
    const many = Array.from(
      { length: CONVERSATION_SIDEBAR_LIMIT + 5 },
      (_, i) => message(`u${i}`, WebviewRole.User, `question ${i}`)
    );
    const items = buildConversationItems(many);

    expect(items).toHaveLength(CONVERSATION_SIDEBAR_LIMIT);
    expect(items[0]?.messageId).toBe(`u${CONVERSATION_SIDEBAR_LIMIT + 4}`);
    expect(items.at(-1)?.messageId).toBe('u5');
  });

  it('formats the sent time when the message has one', () => {
    const [item] = buildConversationItems([
      message('u1', WebviewRole.User, 'hi', {
        createdAt: new Date().toISOString(),
      }),
    ]);
    expect(item?.time).not.toBe('');
  });
});

describe('mergeSidebarMessages', () => {
  it('includes steering echoes and still-queued follow-ups', () => {
    const merged = mergeSidebarMessages(
      [
        message('m1', WebviewRole.User, 'first ask'),
        message('m2', WebviewRole.Assistant, 'working on it'),
      ],
      [
        {
          kind: LiveTurnItemKind.Thinking,
          id: 'live-1',
          content: 'hmm',
          durationMs: 10,
        },
        {
          kind: LiveTurnItemKind.Message,
          id: 'live-2',
          role: WebviewRole.User,
          content: 'actually do this instead',
        },
        {
          kind: LiveTurnItemKind.Message,
          id: 'live-3',
          content: 'assistant prose',
        },
      ],
      [{ id: 'q1', content: 'and this after', images: [] }]
    );

    const items = buildConversationItems(merged);
    expect(items.map((item) => item.preview)).toEqual([
      'and this after',
      'actually do this instead',
      'first ask',
    ]);
  });

  it('returns the committed messages unchanged when nothing is in flight', () => {
    const messages = [message('m1', WebviewRole.User, 'only ask')];
    expect(mergeSidebarMessages(messages)).toEqual(messages);
  });
});

describe('ToggleConversationSidebar reducer action', () => {
  it('defaults the sidebar on', () => {
    expect(initialState.showConversationSidebar).toBe(true);
  });

  it('flips the flag each time', () => {
    const off = reducer(initialState, {
      type: LocalActionType.ToggleConversationSidebar,
    });
    expect(off.showConversationSidebar).toBe(false);

    const backOn = reducer(off, {
      type: LocalActionType.ToggleConversationSidebar,
    });
    expect(backOn.showConversationSidebar).toBe(true);
  });
});
