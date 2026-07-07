import { describe, expect, it } from 'vitest';
import {
  SUB_AGENT_CONFIGS,
  SubAgentType,
  isSubAgentType,
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
