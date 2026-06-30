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

  it('adds tools after construction without changing the advertised set', () => {
    const gatewayOnly = [
      {
        name: 'lazy_load_tools',
        description: 'dispatches to tools',
        parameters: { type: 'object' },
        requiresApproval: false,
      },
    ];
    const registry = new ToolRegistry([fakeTool], gatewayOnly);

    const added: Tool = {
      requiresApproval: true,
      definition: {
        name: 'mcp__srv__do',
        description: 'an mcp tool',
        parameters: { type: 'object' },
      },
      describe: () => ({ title: 'mcp' }),
      execute: async () => ({ content: 'ok' }),
    };
    registry.add([added]);

    // Resolvable and listed…
    expect(registry.get('mcp__srv__do')).toBe(added);
    expect(registry.list()).toContain(added);
    // …but the advertised set (the lazy gateway) is left untouched.
    expect(registry.definitions()).toEqual([
      expect.objectContaining({ name: 'lazy_load_tools' }),
    ]);
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
