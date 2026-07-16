import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// SessionsView pulls in the webview's VS Code API handle for its logo; outside
// a webview `acquireVsCodeApi` doesn't exist, so stub the module.
vi.mock('@ext/webview/vscode-api', () => ({
  logoUri: undefined,
  postToHost: () => {},
}));

import type { WebviewSessionSummary } from '@ext/shared/protocol';
import { SessionsView } from '@ext/webview/components/SessionsView';

const now = new Date().toISOString();

const sessions: WebviewSessionSummary[] = [
  {
    sessionId: 'model-session',
    title: 'Model chat',
    updatedAt: now,
    messageCount: 2,
    model: { providerName: 'Ollama', modelId: 'qwen3' },
  },
  {
    sessionId: 'legacy-session',
    title: 'Legacy chat',
    updatedAt: now,
    messageCount: 1,
  },
];

describe('SessionsView per-session model', () => {
  const html = renderToStaticMarkup(
    <SessionsView
      loading={false}
      sessions={sessions}
      onOpen={() => {}}
      onRename={() => {}}
      onPin={() => {}}
      onDelete={() => {}}
      onClearAll={() => {}}
      onNewSession={() => {}}
    />
  );

  it('shows the provider → model on its own line under the title', () => {
    expect(html).toContain('Ollama → qwen3');
    // Rendered as its own element after the title, not inside the meta line.
    expect(html).toMatch(
      /session-item-title[^]*?<\/span><span class="session-item-model">Ollama → qwen3<\/span>/
    );
    expect(html).not.toMatch(/session-item-meta[^<]*→/);
  });

  it('omits the model for sessions that never recorded one', () => {
    // Only the session with a recorded model renders the arrow.
    expect(html.match(/→/g)).toHaveLength(1);
  });
});

describe('chat bridge per-session model', () => {
  const source = readFileSync(
    join(process.cwd(), 'apps/vscode/src/host/chat-bridge.ts'),
    'utf8'
  );

  it('restores a reopened session’s stored provider and model', () => {
    expect(source).toContain('persistedConversation.model');
    expect(source).toContain('await this.switchToProvider(stored.providerId);');
    expect(source).toContain('this.activeModel = stored.modelId;');
  });

  it('persists an explicit model switch onto the session itself', () => {
    expect(source).toContain('saveSessionModel(');
  });

  it('sends the provider display name with each session summary', () => {
    expect(source).toContain('PROVIDER_BY_ID[s.model.providerId]?.name');
  });
});
