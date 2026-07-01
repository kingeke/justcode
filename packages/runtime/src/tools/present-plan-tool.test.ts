import { describe, expect, it } from 'vitest';

import { PresentPlanTool } from '@runtime/tools/present-plan-tool';

describe('PresentPlanTool', () => {
  const tool = new PresentPlanTool();

  it('does not require approval (it has no side effects)', () => {
    expect(tool.requiresApproval).toBe(false);
  });

  it('echoes the plan back as the tool result', async () => {
    const plan = '# Plan\n\n1. Do the thing\n2. Verify';
    const result = await tool.execute(JSON.stringify({ plan }));

    expect(result.isError).toBeFalsy();
    expect(result.content).toBe(plan);
  });

  it('rejects an empty or missing plan', async () => {
    const empty = await tool.execute(JSON.stringify({ plan: '   ' }));
    expect(empty.isError).toBe(true);
    expect(empty.content).toContain('non-empty string');

    const missing = await tool.execute(JSON.stringify({ notPlan: 'x' }));
    expect(missing.isError).toBe(true);
  });

  it('rejects unparseable arguments', async () => {
    const result = await tool.execute('not json');
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid arguments');
  });

  it('previews the plan in describe()', () => {
    const view = tool.describe(JSON.stringify({ plan: 'do it' }));
    expect(view.title).toBe('Plan');
    expect(view.preview).toBe('do it');

    const bad = tool.describe('not json');
    expect(bad.title).toContain('invalid arguments');
  });
});
