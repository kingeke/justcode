import { describe, expect, it } from 'vitest';

import {
  applyMentionSuggestion,
  applySymbolSuggestion,
  filterMentionSuggestions,
  filterSymbolSuggestions,
  getActiveMentionQuery,
  getActiveSymbolMention,
} from '@core/application/prompt-attachment-service';
import { HostMessageType } from '@ext/shared/protocol';
import { initialState, reducer } from '@ext/webview/state';

// The composer's `@file` / `@path::method` completions are driven by the shared
// core helpers (filtered locally) plus two host-message reducer cases that cache
// the file and symbol lists. These tests lock in that wiring.

describe('mention completions state', () => {
  it('caches the workspace file list from the host', () => {
    const state = reducer(initialState, {
      type: HostMessageType.WorkspaceFiles,
      files: ['src/a.ts', 'src/b.ts'],
    });
    expect(state.workspaceFiles).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('caches a file’s symbols by path, keeping earlier entries', () => {
    const first = reducer(initialState, {
      type: HostMessageType.FileSymbols,
      path: 'src/a.ts',
      symbols: ['foo', 'bar'],
    });
    const second = reducer(first, {
      type: HostMessageType.FileSymbols,
      path: 'src/b.ts',
      symbols: ['baz'],
    });
    expect(second.fileSymbols).toEqual({
      'src/a.ts': ['foo', 'bar'],
      'src/b.ts': ['baz'],
    });
  });
});

describe('mention completion parsing + apply', () => {
  it('completes a trailing @file mention against the file list', () => {
    const query = getActiveMentionQuery('look at @b.ts');
    expect(query).toBe('b.ts');
    const matches = filterMentionSuggestions(['src/a.ts', 'src/b.ts'], query);
    expect(matches).toContain('src/b.ts');
    expect(applyMentionSuggestion('look at @b.ts', 'src/b.ts')).toBe(
      'look at @src/b.ts '
    );
  });

  it('switches to symbol completion once the user types ::', () => {
    // `::` ends the file query and starts a symbol query for the named file.
    expect(getActiveMentionQuery('check @src/a.ts::fo')).toBeUndefined();
    const mention = getActiveSymbolMention('check @src/a.ts::fo');
    expect(mention).toEqual({ path: 'src/a.ts', query: 'fo' });
    const symbols = filterSymbolSuggestions(['foo', 'format', 'bar'], 'fo');
    expect(symbols).toEqual(['foo', 'format']);
    expect(applySymbolSuggestion('check @src/a.ts::fo', 'foo')).toBe(
      'check @src/a.ts::foo '
    );
  });
});
