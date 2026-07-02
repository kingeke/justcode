import { describe, expect, it } from 'vitest';

import { LazyLoadToolsTool } from '@runtime/tools/lazy-load-tools-tool';

describe('LazyLoadToolsTool', () => {
  it('returns the tool catalog (names only, no descriptions) when called with no toggles', async () => {
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
    expect(result.content).toContain('"enable"');
    expect(result.content).toContain(JSON.stringify(['read_file']));
    // Names only: descriptions would ride along in history for the rest of
    // the session, so they must not leak into the catalog.
    expect(result.content).not.toContain('Read a file');
  });

  it('acknowledges enable/disable toggles', async () => {
    const tool = new LazyLoadToolsTool([]);

    const result = await tool.execute(
      JSON.stringify({ enable: ['read_file'], disable: ['bash'] }),
      { workspaceRoot: '/tmp' }
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Enabled: read_file');
    expect(result.content).toContain('Disabled: bash');
    expect(result.content).toContain('next model request');
  });

  it('treats stray or malformed arguments as a catalog request', async () => {
    const tool = new LazyLoadToolsTool([]);

    for (const rawArguments of [
      '',
      '{}',
      JSON.stringify({ tool_name: 'read_file' }),
      'not json',
      JSON.stringify({ enable: 'read_file' }), // wrong shape: not an array
    ]) {
      const result = await tool.execute(rawArguments, {
        workspaceRoot: '/tmp',
      });
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('Available tools');
    }
  });

  it('summarizes the call for the UI', () => {
    const tool = new LazyLoadToolsTool([]);

    expect(tool.describe('{}').title).toBe('lazy_load_tools');
    expect(tool.describe('{}').preview).toContain('List available tools');
    expect(
      tool.describe(JSON.stringify({ enable: ['grep', 'bash'] })).preview
    ).toContain('Enable grep, bash');
    expect(
      tool.describe(JSON.stringify({ disable: ['grep'] })).preview
    ).toContain('Disable grep');
  });
});
