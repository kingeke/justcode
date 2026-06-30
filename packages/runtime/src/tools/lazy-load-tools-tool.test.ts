import { describe, expect, it } from 'vitest';

import { LazyLoadToolsTool } from '@runtime/tools/lazy-load-tools-tool';

describe('LazyLoadToolsTool', () => {
  it('acknowledges loading and reveals the full toolset for the next request', async () => {
    const tool = new LazyLoadToolsTool([
      {
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object' },
        requiresApproval: false,
      },
    ]);

    const result = await tool.execute('{}', { workspaceRoot: '/tmp' });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Tool loading acknowledged');
    expect(result.content).toContain('full toolset');
  });

  it('ignores stray arguments passed by accident and still succeeds', async () => {
    const tool = new LazyLoadToolsTool([]);

    const result = await tool.execute(
      JSON.stringify({ tool_name: 'read_file' }),
      { workspaceRoot: '/tmp' }
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Tool loading acknowledged');
  });

  it('allows an empty string or empty object call shape from providers', async () => {
    const tool = new LazyLoadToolsTool([]);

    await expect(tool.execute('', { workspaceRoot: '/tmp' })).resolves.toEqual(
      expect.objectContaining({
        content: expect.stringContaining('Tool loading acknowledged'),
      })
    );
    await expect(
      tool.execute('{}', { workspaceRoot: '/tmp' })
    ).resolves.toEqual(
      expect.objectContaining({
        content: expect.stringContaining('Tool loading acknowledged'),
      })
    );
  });

  it('summarizes the call for the UI', () => {
    const tool = new LazyLoadToolsTool([]);

    const view = tool.describe('{}');

    expect(view.title).toBe('lazy_load_tools');
    expect(view.preview).toContain('full toolset');
  });
});
