import { describe, expect, it } from 'vitest';

import {
  activeOccurrence,
  findOccurrences,
  locateOffset,
  OffsetEdge,
} from '@ext/webview/search-highlight';
import type { TranscriptMatch } from '@ext/webview/transcript-search';

describe('findOccurrences', () => {
  it('returns every case-insensitive span of the query', () => {
    expect(findOccurrences('Search and search again', 'search')).toEqual([
      { start: 0, end: 6 },
      { start: 11, end: 17 },
    ]);
  });

  it('does not overlap spans', () => {
    expect(findOccurrences('aaaa', 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it('returns nothing for a blank query or no hit', () => {
    expect(findOccurrences('hello', '  ')).toEqual([]);
    expect(findOccurrences('hello', 'zzz')).toEqual([]);
  });
});

describe('locateOffset', () => {
  // Text nodes of lengths 5 / 3 / 4 => "helloabcdefg" style concatenation.
  const lengths = [5, 3, 4];

  it('maps an offset inside the first node', () => {
    expect(locateOffset(lengths, 2, OffsetEdge.Start)).toEqual({
      index: 0,
      offset: 2,
    });
  });

  it('sends a span start on a boundary to the following node', () => {
    expect(locateOffset(lengths, 5, OffsetEdge.Start)).toEqual({
      index: 1,
      offset: 0,
    });
  });

  it('keeps a span end on a boundary in the preceding node', () => {
    expect(locateOffset(lengths, 5, OffsetEdge.End)).toEqual({
      index: 0,
      offset: 5,
    });
  });

  it('resolves the very end of the last node', () => {
    expect(locateOffset(lengths, 12, OffsetEdge.End)).toEqual({
      index: 2,
      offset: 4,
    });
  });

  it('returns undefined past the end or below zero', () => {
    expect(locateOffset(lengths, 13, OffsetEdge.End)).toBeUndefined();
    expect(locateOffset(lengths, 12, OffsetEdge.Start)).toBeUndefined();
    expect(locateOffset(lengths, -1, OffsetEdge.Start)).toBeUndefined();
  });
});

describe('activeOccurrence', () => {
  const matches: TranscriptMatch[] = [
    { messageId: 'm1', count: 1 },
    { messageId: 'm2', count: 2 },
  ];

  it('resolves the message and the hit position inside it', () => {
    expect(activeOccurrence(matches, 0)).toEqual({
      messageId: 'm1',
      indexInMessage: 0,
    });
    expect(activeOccurrence(matches, 1)).toEqual({
      messageId: 'm2',
      indexInMessage: 0,
    });
    expect(activeOccurrence(matches, 2)).toEqual({
      messageId: 'm2',
      indexInMessage: 1,
    });
  });

  it('returns undefined outside the range', () => {
    expect(activeOccurrence(matches, 3)).toBeUndefined();
    expect(activeOccurrence(matches, -1)).toBeUndefined();
    expect(activeOccurrence([], 0)).toBeUndefined();
  });
});
