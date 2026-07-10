import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SUB_AGENT_PROMPT_ID_PREFIX } from '@ext/shared/settings-protocol';

describe('settings Agents & Prompts tab', () => {
  const app = readFileSync(
    join(process.cwd(), 'apps/vscode/src/webview/SettingsApp.tsx'),
    'utf8'
  );
  const panel = readFileSync(
    join(process.cwd(), 'apps/vscode/src/host/settings-panel.ts'),
    'utf8'
  );

  it('splits mode prompts and sub agents into two tabs', () => {
    expect(app).toContain('PromptSection.Prompts');
    expect(app).toContain('PromptSection.SubAgents');
    expect(app).toMatch(/System prompts\s*<\/button>/);
    expect(app).toMatch(/Sub agents\s*<\/button>/);
    // Each tab shows only its own rows, keyed off the shared prefix.
    expect(app).toContain(
      'p.id.startsWith(SUB_AGENT_PROMPT_ID_PREFIX) === onSubAgentsTab'
    );
  });

  it('rows carry custom/edited badges instead of subsections', () => {
    expect(app).toContain('>custom</span>');
    expect(app).toContain('>edited</span>');
    // The old section headings are gone.
    expect(app).not.toContain('Built-in sub agent prompts');
    expect(app).not.toContain('Custom sub agent prompts');
  });

  it('rows expand via a chevron and show a description line', () => {
    expect(app).toContain('ChevronRightIcon');
    expect(app).toContain('ChevronDownIcon');
    expect(app).toContain('prompt.description');
  });

  it('offers creating modes and sub agents from the list header', () => {
    expect(app).toContain('New mode');
    expect(app).toContain('New sub agent');
    expect(app).toContain('CreateSubAgentForm');
    expect(app).toContain('SettingsWebviewMessageType.CreateSubAgent');
    // Read-only toggle for the new agent's toolset.
    expect(app).toContain('Read-only (search/read tools only');
  });

  it('the host describes every prompt row', () => {
    expect(panel).toContain('description: modeDescriptions[mode.id]');
    expect(panel).toContain('description: SUB_AGENT_CONFIGS[type].summary');
  });

  it('marks the open card so it can carry the accent border', () => {
    const css = readFileSync(
      join(process.cwd(), 'apps/vscode/src/webview/webview.css'),
      'utf8'
    );
    expect(app).toContain("expanded ? ' prompt-card-expanded' : ''");
    expect(css).toContain('.prompt-card-expanded {');
    expect(css).toContain('border-left: 2px solid var(--vscode-focusBorder');
  });

  it('names the mode/sub agent the default-model row belongs to', () => {
    expect(app).toContain(
      '<span className="prompt-default-model-owner">for {prompt.name}</span>'
    );
  });

  it('re-sends the prompts (and their model options) when providers change', () => {
    // A freshly connected provider must reach the default-model pickers, which
    // are rendered from the model list that rides along with the prompts.
    expect(panel).toContain('sendProvidersAndPrompts');
    expect(panel).not.toMatch(
      /result\.success\)\s*{\s*this\.onProvidersChanged\(\);\s*await this\.sendProviders\(\);/
    );
  });

  it('routes custom sub agent ids through the shared prefix constant', () => {
    expect(SUB_AGENT_PROMPT_ID_PREFIX).toBe('subagent-');
    expect(panel).toContain('SUB_AGENT_PROMPT_ID_PREFIX');
    expect(panel).toContain('addCustomSubAgent');
    expect(panel).toContain('removeCustomSubAgent');
    // No stray literals besides the shared constant's definition site.
    expect(panel).not.toContain("startsWith('subagent-')");
  });
});
