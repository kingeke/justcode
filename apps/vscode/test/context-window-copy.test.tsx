import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Composer } from '@ext/webview/components/Composer';

describe('context window copy', () => {
  it('uses context window wording in the VS Code composer settings UI', () => {
    const markup = renderToStaticMarkup(
      <Composer
        busy={false}
        disabled={false}
        models={[]}
        activeModel={undefined}
        activeProviderId={undefined}
        usage={undefined}
        stats={undefined}
        autoApplyWrites={false}
        expandTools={false}
        maxReadLines={300}
        maxHistoryMessages={50}
        onSubmit={() => {}}
        onCancel={() => {}}
        onNewSession={() => {}}
        onOpenModelPicker={() => {}}
        thinkingCollapsed={false}
        onToggleAutoWrites={() => {}}
        onToggleExpandTools={() => {}}
        onSetReadLimit={() => {}}
        onSetHistoryLimit={() => {}}
        onToggleThinkingCollapsed={() => {}}
      />
    );

    expect(markup).toContain('Context Window');
    expect(markup).toContain(
      'Recent context window items sent to model — 0 means send all'
    );
    expect(markup).not.toContain('Max History Sent');
  });

  it('uses context window wording in CLI help text', () => {
    const commandsSource = readFileSync('apps/cli/src/ui/commands.ts', 'utf8');
    const chatAppSource = readFileSync('apps/cli/src/ui/chat-app.tsx', 'utf8');

    expect(commandsSource).toContain('recent context window items');
    expect(commandsSource).toContain('/context-window 50');
    expect(commandsSource).not.toContain('/history-limit 50');
    expect(chatAppSource).toContain('Context window is');
    expect(chatAppSource).toContain('/context-window <count|off>');
    expect(chatAppSource).toContain('Context window set to');
    expect(chatAppSource).toContain('positive number of items');
    expect(chatAppSource).not.toContain('History limit set to');
  });
});
