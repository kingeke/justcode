import { describe, expect, it } from 'vitest';

import { ToolRegistry } from '@core/application/tool-registry';
import type { Tool } from '@core/ports/tool';

const fakeTool: Tool = {
  requiresApproval: false,
  definition: {
    name: 'noop',
    description: 'does nothing',
    parameters: { type: 'object' },
  },
  describe: () => ({ title: 'noop' }),
  execute: async () => ({ content: 'ok' }),
};

describe('ToolRegistry', () => {
  it('resolves tools by name and exposes their definitions', () => {
    const registry = new ToolRegistry([fakeTool]);

    expect(registry.get('noop')).toBe(fakeTool);
    expect(registry.get('missing')).toBeUndefined();
    expect(registry.definitions()).toEqual([fakeTool.definition]);
    expect(registry.list()).toEqual([fakeTool]);
    expect(registry.isEmpty()).toBe(false);
  });

  it('is empty when constructed without tools', () => {
    expect(new ToolRegistry().isEmpty()).toBe(true);
  });

  it('can advertise a different tool definition set than the executable tools', () => {
    const registry = new ToolRegistry(
      [fakeTool],
      [
        {
          name: 'lazy_load_tools',
          description: 'dispatches to tools',
          parameters: { type: 'object' },
          requiresApproval: false,
        },
      ]
    );

    expect(registry.definitions()).toEqual([
      expect.objectContaining({ name: 'lazy_load_tools' }),
    ]);
    expect(registry.get('noop')).toBe(fakeTool);
  });
});
