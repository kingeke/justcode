import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WebviewRole } from '@ext/shared/protocol';
import { MessageView } from '@ext/webview/components/MessageView';
import { TranscriptSearch } from '@ext/webview/components/TranscriptSearch';

describe('TranscriptSearch bar', () => {
  it('reports the active match position out of the total', () => {
    const markup = renderToStaticMarkup(
      <TranscriptSearch
        query="search"
        matchCount={3}
        activeIndex={1}
        onQueryChange={() => {}}
        onNext={() => {}}
        onPrevious={() => {}}
        onClose={() => {}}
      />
    );
    expect(markup).toContain('2 of 3');
    expect(markup).not.toContain('transcript-search-input-empty');
  });

  it('flags a query with no hits', () => {
    const markup = renderToStaticMarkup(
      <TranscriptSearch
        query="zzz"
        matchCount={0}
        activeIndex={0}
        onQueryChange={() => {}}
        onNext={() => {}}
        onPrevious={() => {}}
        onClose={() => {}}
      />
    );
    expect(markup).toContain('No results');
    expect(markup).toContain('transcript-search-input-empty');
    // Stepping is pointless with nothing to step to.
    expect(markup).toContain('disabled');
  });

  it('shows no count for an empty query', () => {
    const markup = renderToStaticMarkup(
      <TranscriptSearch
        query=""
        matchCount={0}
        activeIndex={0}
        onQueryChange={() => {}}
        onNext={() => {}}
        onPrevious={() => {}}
        onClose={() => {}}
      />
    );
    expect(markup).not.toContain('No results');
  });
});

describe('MessageView search anchor', () => {
  it('keeps the domId anchor the find bar scrolls and highlights through', () => {
    // Matched words are painted by the CSS Custom Highlight API against this
    // element's `.msg-content`, so the id is the whole contract — no wrapper
    // styling is added around a matching message.
    const markup = renderToStaticMarkup(
      <MessageView
        message={{ id: 'm1', role: WebviewRole.User, content: 'hello' }}
        domId="msg-m1"
      />
    );
    expect(markup).toContain('id="msg-m1"');
    expect(markup).toContain('msg-content');
  });
});
