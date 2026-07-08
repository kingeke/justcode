import { describe, expect, it } from 'vitest';
import {
  SUB_AGENT_CONFIGS,
  SubAgentType,
  addCustomSubAgent,
  isSubAgentType,
  removeCustomSubAgent,
  resolveSubAgentConfig,
  uniqueSubAgentId,
} from '@core/domain/sub-agent';
import { ToolName } from '@core/domain/tool-name';

describe('sub agent configs', () => {
  it('defines a config for every sub agent type', () => {
    for (const type of Object.values(SubAgentType)) {
      const config = SUB_AGENT_CONFIGS[type];
      expect(config.allowedTools.length).toBeGreaterThan(0);
      expect(config.systemPrompt.length).toBeGreaterThan(0);
      expect(config.summary.length).toBeGreaterThan(0);
    }
  });

  it('keeps the explorer strictly read-only', () => {
    const allowed = SUB_AGENT_CONFIGS[SubAgentType.Explorer].allowedTools;
    for (const forbidden of [
      ToolName.WriteFile,
      ToolName.EditFile,
      ToolName.ApplyPatch,
      ToolName.Bash,
    ]) {
      expect(allowed).not.toContain(forbidden);
    }
  });

  it('never allows recursive or interactive tools in any type', () => {
    for (const type of Object.values(SubAgentType)) {
      const allowed = SUB_AGENT_CONFIGS[type].allowedTools;
      for (const forbidden of [
        ToolName.Task,
        ToolName.Question,
        ToolName.PresentPlan,
        ToolName.LazyLoadTools,
      ]) {
        expect(allowed).not.toContain(forbidden);
      }
    }
  });

  it('recognises sub agent type strings', () => {
    expect(isSubAgentType('explorer')).toBe(true);
    expect(isSubAgentType('general')).toBe(true);
    expect(isSubAgentType('nonsense')).toBe(false);
  });
});

describe('custom sub agents', () => {
  it('creates an agent with a slugged id that avoids built-in types', () => {
    const created = addCustomSubAgent('Explorer', {});
    expect(created).not.toBeNull();
    expect(created?.id).toBe('explorer-2');
    expect(created?.customSubAgents['explorer-2']?.name).toBe('Explorer');
  });

  it('rejects a blank name and does not mutate the input map', () => {
    const existing = {};
    expect(addCustomSubAgent('   ', {}, existing)).toBeNull();
    expect(existing).toEqual({});
  });

  it('stores only the fields that were provided', () => {
    const created = addCustomSubAgent('Docs Writer', {
      summary: '  Writes docs.  ',
      systemPrompt: '',
      readOnly: false,
    });
    expect(created?.customSubAgents['docs-writer']).toEqual({
      name: 'Docs Writer',
      summary: 'Writes docs.',
    });
  });

  it('removes only existing custom agents', () => {
    const created = addCustomSubAgent('Reviewer', { readOnly: true });
    const removed = removeCustomSubAgent(
      'reviewer',
      created?.customSubAgents ?? {}
    );
    expect(removed?.customSubAgents).toEqual({});
    expect(removeCustomSubAgent('explorer', {})).toBeNull();
  });

  it('dedupes ids against existing custom agents', () => {
    const first = addCustomSubAgent('Docs', {});
    const second = addCustomSubAgent('Docs', {}, first?.customSubAgents);
    expect(second?.id).toBe('docs-2');
    expect(uniqueSubAgentId('general')).toBe('general-2');
  });
});

describe('resolveSubAgentConfig', () => {
  it('resolves built-in types to their configs', () => {
    expect(resolveSubAgentConfig(SubAgentType.Explorer)).toBe(
      SUB_AGENT_CONFIGS[SubAgentType.Explorer]
    );
  });

  it('maps a custom agent to the right toolset and prompt fallback', () => {
    const custom = {
      reviewer: { name: 'Reviewer', readOnly: true },
      builder: { name: 'Builder', systemPrompt: 'Build things.' },
    };
    const reviewer = resolveSubAgentConfig('reviewer', custom);
    expect(reviewer?.allowedTools).toEqual(
      SUB_AGENT_CONFIGS[SubAgentType.Explorer].allowedTools
    );
    // No prompt of its own → the General prompt.
    expect(reviewer?.systemPrompt).toBe(
      SUB_AGENT_CONFIGS[SubAgentType.General].systemPrompt
    );
    const builder = resolveSubAgentConfig('builder', custom);
    expect(builder?.allowedTools).toEqual(
      SUB_AGENT_CONFIGS[SubAgentType.General].allowedTools
    );
    expect(builder?.systemPrompt).toBe('Build things.');
  });

  it('returns undefined for unknown types', () => {
    expect(resolveSubAgentConfig('nope', {})).toBeUndefined();
  });
});
