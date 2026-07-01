import { describe, expect, it } from 'vitest';

import { ViewHistoryTool } from '@runtime/tools/view-history-tool';

describe('ViewHistoryTool', () => {
  const tool = new ViewHistoryTool();
  const context = { workspaceRoot: '/tmp' };

  it('does not require approval', () => {
    expect(tool.requiresApproval).toBe(false);
  });

  it('describes an open-ended and a bounded range', () => {
    expect(tool.describe(JSON.stringify({ start: 3 })).title).toBe(
      'view history from #3'
    );
    expect(tool.describe(JSON.stringify({ start: 3, end: 8 })).title).toBe(
      'view history #3–8'
    );
    expect(tool.describe('not json').title).toContain('unparseable');
  });

  it('reports that history is only available inside a chat session', async () => {
    const result = await tool.execute(JSON.stringify({ start: 0 }), context);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('active chat session');
  });
});
