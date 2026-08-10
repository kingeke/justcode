import { describe, expect, it } from 'vitest';

import { WebviewRole, type WebviewMessage } from '@ext/shared/protocol';
import {
  countTranscriptMatches,
  findTranscriptMatches,
  isSearchableMessage,
  matchMessageIdAt,
  SearchDirection,
  stepMatchIndex,
} from '@ext/webview/transcript-search';
import { isFindShortcut, KeyboardKey } from '@ext/webview/platform';

function message(
  id: string,
  content: string,
  role: WebviewRole = WebviewRole.User
): WebviewMessage {
  return { id, role, content };
}

const transcript: WebviewMessage[] = [
  message('m1', 'Add a Ctrl+F search to the chat'),
  message(
    'm2',
    'Sure — search is now wired up, search bar included',
    WebviewRole.Assistant
  ),
  message('m3', 'unrelated reply', WebviewRole.Assistant),
];

describe('findTranscriptMatches', () => {
  it('returns matching messages in transcript order with occurrence counts', () => {
    expect(findTranscriptMatches(transcript, 'search')).toEqual([
      { messageId: 'm1', count: 1 },
      { messageId: 'm2', count: 2 },
    ]);
  });

  it('matches case-insensitively', () => {
    expect(findTranscriptMatches(transcript, 'CTRL+F')).toEqual([
      { messageId: 'm1', count: 1 },
    ]);
  });

  it('treats a blank query as no matches', () => {
    expect(findTranscriptMatches(transcript, '   ')).toEqual([]);
    expect(findTranscriptMatches(transcript, '')).toEqual([]);
  });

  it('returns nothing when the query is absent', () => {
    expect(findTranscriptMatches(transcript, 'zzz')).toEqual([]);
  });

  it('skips tool input/output and compaction summaries', () => {
    const withTools: WebviewMessage[] = [
      message('m1', 'where is the search wired?'),
      {
        ...message('t1', 'search hit in grep output', WebviewRole.Tool),
        toolName: 'grep',
      },
      { ...message('c1', 'earlier search talk'), isCompactSummary: true },
    ];
    expect(findTranscriptMatches(withTools, 'search')).toEqual([
      { messageId: 'm1', count: 1 },
    ]);
  });
});

describe('isSearchableMessage', () => {
  it('includes user and assistant messages', () => {
    expect(isSearchableMessage(message('m1', 'hi'))).toBe(true);
    expect(
      isSearchableMessage(message('m2', 'hi', WebviewRole.Assistant))
    ).toBe(true);
  });

  it('excludes tool messages and compaction summaries', () => {
    expect(isSearchableMessage(message('t1', 'hi', WebviewRole.Tool))).toBe(
      false
    );
    expect(
      isSearchableMessage({ ...message('c1', 'hi'), isCompactSummary: true })
    ).toBe(false);
  });
});

describe('countTranscriptMatches', () => {
  it('sums occurrences across matching messages', () => {
    expect(
      countTranscriptMatches(findTranscriptMatches(transcript, 'search'))
    ).toBe(3);
  });

  it('is zero with no matches', () => {
    expect(countTranscriptMatches([])).toBe(0);
  });
});

describe('matchMessageIdAt', () => {
  const matches = findTranscriptMatches(transcript, 'search');

  it('maps an occurrence index onto the message holding it', () => {
    expect(matchMessageIdAt(matches, 0)).toBe('m1');
    expect(matchMessageIdAt(matches, 1)).toBe('m2');
    expect(matchMessageIdAt(matches, 2)).toBe('m2');
  });

  it('returns undefined outside the range', () => {
    expect(matchMessageIdAt(matches, 3)).toBeUndefined();
    expect(matchMessageIdAt(matches, -1)).toBeUndefined();
    expect(matchMessageIdAt([], 0)).toBeUndefined();
  });
});

describe('stepMatchIndex', () => {
  it('advances and wraps at the end', () => {
    expect(stepMatchIndex(0, 3, SearchDirection.Next)).toBe(1);
    expect(stepMatchIndex(2, 3, SearchDirection.Next)).toBe(0);
  });

  it('goes back and wraps at the start', () => {
    expect(stepMatchIndex(1, 3, SearchDirection.Previous)).toBe(0);
    expect(stepMatchIndex(0, 3, SearchDirection.Previous)).toBe(2);
  });

  it('stays at 0 with nothing to step through', () => {
    expect(stepMatchIndex(0, 0, SearchDirection.Next)).toBe(0);
    expect(stepMatchIndex(0, 0, SearchDirection.Previous)).toBe(0);
  });
});

describe('isFindShortcut', () => {
  const key = (
    overrides: Partial<{
      key: string;
      metaKey: boolean;
      ctrlKey: boolean;
      altKey: boolean;
    }>
  ): { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean } => ({
    key: KeyboardKey.F,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...overrides,
  });

  it('matches Ctrl+F and Cmd+F', () => {
    expect(isFindShortcut(key({ ctrlKey: true }))).toBe(true);
    expect(isFindShortcut(key({ metaKey: true }))).toBe(true);
    expect(isFindShortcut(key({ key: 'F', ctrlKey: true }))).toBe(true);
  });

  it('ignores a plain "f" keypress and other chords', () => {
    expect(isFindShortcut(key({}))).toBe(false);
    expect(isFindShortcut(key({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isFindShortcut(key({ key: KeyboardKey.A, ctrlKey: true }))).toBe(
      false
    );
  });
});
