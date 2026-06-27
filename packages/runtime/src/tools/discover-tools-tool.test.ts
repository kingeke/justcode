import { describe, expect, it } from 'vitest';

import { DiscoverToolsTool } from '@runtime/tools/discover-tools-tool';

describe('DiscoverToolsTool', () => {
  it('acknowledges discovery and reveals the full toolset for the next request', async () => {
    const tool = new DiscoverToolsTool([
      {
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object' },
        requiresApproval: false,
      },
    ]);

    const result = await tool.execute('{}', { workspaceRoot: '/tmp' });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Tool discovery acknowledged');
    expect(result.content).toContain('full toolset');
  });

  it('rejects non-empty arguments', async () => {
    const tool = new DiscoverToolsTool([]);

    await expect(
      tool.execute(JSON.stringify({ tool_name: 'read_file' }), {
        workspaceRoot: '/tmp',
      })
    ).resolves.toEqual(expect.objectContaining({ isError: true }));
  });

  it('allows an empty string or empty object call shape from providers', async () => {
    const tool = new DiscoverToolsTool([]);

    await expect(tool.execute('', { workspaceRoot: '/tmp' })).resolves.toEqual(
      expect.objectContaining({
        content: expect.stringContaining('Tool discovery acknowledged'),
      })
    );
    await expect(
      tool.execute('{}', { workspaceRoot: '/tmp' })
    ).resolves.toEqual(
      expect.objectContaining({
        content: expect.stringContaining('Tool discovery acknowledged'),
      })
    );
  });

  it('summarizes the call for the UI', () => {
    const tool = new DiscoverToolsTool([]);

    const view = tool.describe('{}');

    expect(view.title).toBe('discover_tools');
    expect(view.preview).toContain('full toolset');
  });
});
