import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { WebviewSubAgentStatus } from '@ext/shared/protocol';
import { SubAgentPanel } from '@ext/webview/components/SubAgentPanel';
import type { SubAgentRunView } from '@ext/webview/state';

describe('SubAgentPanel row layout', () => {
  const runs: SubAgentRunView[] = [
    {
      runId: 'run-1',
      agentType: 'explorer',
      description: 'Explore llm-test project structure and contents',
      model: 'qwen/qwen3-coder-next',
      providerId: 'openrouter',
      toolUseCount: 2,
      status: WebviewSubAgentStatus.Running,
      latestActivity: 'glob: **/llm-test/**/*',
      startedAt: 1000,
    },
  ];
  const markup = renderToStaticMarkup(
    <SubAgentPanel runs={runs} onOpen={() => {}} />
  );
  const css = readFileSync(
    join(process.cwd(), 'apps/vscode/src/webview/webview.css'),
    'utf8'
  );

  it('renders the provider and model on the row', () => {
    expect(markup).toContain('subagents-model');
    expect(markup).toContain('openrouter');
    expect(markup).toContain('qwen/qwen3-coder-next');
  });

  it('keeps the long model id on one line so the row stays single-height', () => {
    const rule = css.slice(css.indexOf('.subagents-model {'));
    const block = rule.slice(0, rule.indexOf('}'));
    expect(block).toContain('white-space: nowrap');
    expect(block).toContain('text-overflow: ellipsis');
    expect(block).toContain('min-width: 0');
  });

  it('lets the description shrink to its ellipsis instead of widening the row', () => {
    const rule = css.slice(css.indexOf('.subagents-desc {'));
    const block = rule.slice(0, rule.indexOf('}'));
    expect(block).toContain('min-width: 0');
    expect(block).toContain('text-overflow: ellipsis');
  });
});
