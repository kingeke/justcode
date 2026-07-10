import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Composer, type ComposerProps } from '@ext/webview/components/Composer';
import { WebviewModeIcon } from '@ext/shared/protocol';

function baseProps(overrides: Partial<ComposerProps> = {}): ComposerProps {
  return {
    busy: false,
    disabled: false,
    models: [],
    activeModel: undefined,
    activeProviderId: undefined,
    usage: undefined,
    stats: undefined,
    autoApprove: false,
    expandTools: false,
    maxReadLines: 200,
    maxHistoryMessages: 0,
    reasoningEffortByModel: {},
    onSetReasoningEffort: () => {},
    onSubmit: () => {},
    onCancel: () => {},
    workspaceFiles: [],
    fileSymbols: {},
    onRequestWorkspaceFiles: () => {},
    onRequestFileSymbols: () => {},
    onNewSession: () => {},
    onOpenModelPicker: () => {},
    onToggleAutoApprove: () => {},
    onToggleExpandTools: () => {},
    onSetReadLimit: () => {},
    onSetHistoryLimit: () => {},
    thinkingCollapsed: false,
    onToggleThinkingCollapsed: () => {},
    localModelAutoRefresh: false,
    modelAutoRefresh: true,
    onToggleLocalModelAutoRefresh: () => {},
    onToggleModelAutoRefresh: () => {},
    lazyToolLoading: false,
    onToggleLazyToolLoading: () => {},
    manageableTools: [],
    disabledTools: [],
    onSetDisabledTools: () => {},
    onOpenMcpConfig: () => {},
    onOpenPromptSettings: () => {},
    mcpLoading: false,
    modes: [
      {
        id: 'ask',
        name: 'Ask',
        icon: WebviewModeIcon.Ask,
        custom: false,
      },
    ],
    activeModeId: 'ask',
    modelDefaults: { byMode: {}, bySubAgent: {} },
    onSelectMode: () => {},
    onCreateMode: () => {},
    onDeleteMode: () => {},
    onSetModeDefaultModel: () => {},
    onClearModeDefaultModel: () => {},
    autoCompactThresholdPercent: 0,
    onSetAutoCompactThreshold: () => {},
    compacting: false,
    onCompact: () => {},
    ...overrides,
  };
}

describe('Composer context popup', () => {
  it('shows a session info trigger even when the active model has no context window', () => {
    const markup = renderToStaticMarkup(
      <Composer
        {...baseProps({
          models: [
            {
              id: 'model-a',
              displayName: 'Model A',
              providerId: 'provider-a',
              providerName: 'Provider A',
            },
          ],
          activeModel: 'model-a',
          activeProviderId: 'provider-a',
        })}
      />
    );

    expect(markup).toContain('Session info and conversation compaction');
    expect(markup).toContain('<svg');
    expect(markup).not.toContain('Context window 0% full');
  });

  it('shows the context ring trigger when the active model reports a context window', () => {
    const markup = renderToStaticMarkup(
      <Composer
        {...baseProps({
          models: [
            {
              id: 'model-b',
              displayName: 'Model B',
              providerId: 'provider-a',
              providerName: 'Provider A',
              contextWindow: 1000,
            },
          ],
          activeModel: 'model-b',
          activeProviderId: 'provider-a',
          usage: {
            lastInputTokens: 250,
            inputTokens: 250,
            cachedTokens: 0,
            outputTokens: 0,
          },
        })}
      />
    );

    expect(markup).toContain('Context window 25% full');
  });
});
