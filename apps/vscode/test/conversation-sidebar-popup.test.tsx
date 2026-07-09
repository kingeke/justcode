import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WebviewRole } from '@ext/shared/protocol';
import { ConversationSidebar } from '@ext/webview/components/ConversationSidebar';

describe('ConversationSidebar popup', () => {
  const markup = renderToStaticMarkup(
    <ConversationSidebar
      messages={[{ id: 'u1', role: WebviewRole.User, content: 'hello' }]}
      onSelect={() => {}}
    />
  );

  it('starts closed: the click state class is absent by default', () => {
    // The panel opens via the `is-open` class set on click (not CSS hover), so
    // a fresh render must not carry it.
    expect(markup).not.toContain('is-open');
  });

  it('marks the trigger as a collapsed toggle for accessibility', () => {
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-label="Your messages"');
  });
});
