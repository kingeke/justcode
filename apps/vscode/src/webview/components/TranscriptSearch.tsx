import * as React from 'react';

import { ChevronDownIcon, ChevronUpIcon } from '@ext/webview/components/Icons';
import { isSelectAllShortcut, KeyboardKey } from '@ext/webview/platform';

interface TranscriptSearchProps {
  query: string;
  /** Total occurrences of the query across the transcript. */
  matchCount: number;
  /** Zero-based index of the match currently focused, for the "3 of 12" label. */
  activeIndex: number;
  onQueryChange: (query: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}

/**
 * The chat's find bar (Ctrl/Cmd+F): a floating input over the transcript that
 * reports how many times the query occurs and steps through the matches. VS
 * Code's editor find widget doesn't reach webview views, so the chat provides
 * its own.
 */
export function TranscriptSearch({
  query,
  matchCount,
  activeIndex,
  onQueryChange,
  onNext,
  onPrevious,
  onClose,
}: TranscriptSearchProps): React.JSX.Element {
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Opening the bar (and re-pressing the shortcut) should land the caret in the
  // input with any existing query selected, matching VS Code's find widget.
  React.useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const noResults = query.trim() !== '' && matchCount === 0;

  return (
    <div className="transcript-search" role="search">
      <input
        ref={inputRef}
        className={`transcript-search-input${noResults ? ' transcript-search-input-empty' : ''}`}
        type="text"
        value={query}
        placeholder="Find in conversation"
        aria-label="Find in conversation"
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          // VS Code's workbench swallows the native select-all in webviews.
          if (isSelectAllShortcut(event)) {
            event.preventDefault();
            event.currentTarget.select();
            return;
          }
          if (event.key === KeyboardKey.Escape) {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key === KeyboardKey.Enter) {
            event.preventDefault();
            if (event.shiftKey) onPrevious();
            else onNext();
          }
        }}
      />
      <span className="transcript-search-count" aria-live="polite">
        {query.trim() === ''
          ? ''
          : matchCount === 0
            ? 'No results'
            : `${activeIndex + 1} of ${matchCount}`}
      </span>
      <button
        type="button"
        className="transcript-search-btn"
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
        disabled={matchCount === 0}
        onClick={onPrevious}
      >
        <ChevronUpIcon size={14} />
      </button>
      <button
        type="button"
        className="transcript-search-btn"
        title="Next match (Enter)"
        aria-label="Next match"
        disabled={matchCount === 0}
        onClick={onNext}
      >
        <ChevronDownIcon size={14} />
      </button>
      <button
        type="button"
        className="transcript-search-btn transcript-search-close"
        title="Close find (Esc)"
        aria-label="Close find"
        onClick={onClose}
      >
        ✕
      </button>
    </div>
  );
}
