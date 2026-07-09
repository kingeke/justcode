import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WebviewSubAgentStatus } from '@ext/shared/protocol';
import { SubAgentSidebar } from '@ext/webview/components/SubAgentPanel';
import type { SubAgentRunView } from '@ext/webview/state';

describe('SubAgentSidebar popup', () => {
  const runs: SubAgentRunView[] = [
    {
      runId: 'run-1',
      agentType: 'general',
      description: 'Build the CSS',
      toolUseCount: 2,
      status: WebviewSubAgentStatus.Completed,
      startedAt: 1000,
      endedAt: 5000,
    },
  ];
  const markup = renderToStaticMarkup(
    <SubAgentSidebar runs={runs} onOpen={() => {}} />
  );

  it('starts closed: the click state class is absent by default', () => {
    // Like "Your messages", the panel opens via the `is-open` class set on
    // click (not CSS hover), so a fresh render must not carry it.
    expect(markup).not.toContain('is-open');
  });

  it('marks the trigger as a collapsed toggle for accessibility', () => {
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-label="Sub agents"');
  });

  it('renders nothing when there are no runs', () => {
    expect(
      renderToStaticMarkup(<SubAgentSidebar runs={[]} onOpen={() => {}} />)
    ).toBe('');
  });
});
