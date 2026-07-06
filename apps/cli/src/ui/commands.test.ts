import { describe, expect, it } from 'vitest';

import {
  CommandName,
  filterCommands,
  isCommandName,
  parseCommandInput,
} from '@cli/ui/commands';

describe('commands', () => {
  it('recognizes valid command names', () => {
    expect(isCommandName(CommandName.Reset)).toBe(true);
    expect(isCommandName('not-a-command')).toBe(false);
  });

  it('registers the compaction commands', () => {
    expect(isCommandName(CommandName.Compact)).toBe(true);
    expect(isCommandName(CommandName.AutoCompact)).toBe(true);
    // "/compact" must rank the exact name over auto-compact's substring match.
    expect(filterCommands('compact')[0]?.name).toBe(CommandName.Compact);
    expect(filterCommands('auto-compact')[0]?.name).toBe(
      CommandName.AutoCompact
    );
  });

  it('ranks prefix matches ahead of fuzzy matches', () => {
    // Whole-name prefix matches come first, in declaration order; segment/
    // substring matches (e.g. "refresh" in local-model-refresh) follow.
    expect(
      filterCommands('re')
        .map((command) => command.name)
        .slice(0, 4)
    ).toEqual([
      CommandName.RefreshModels,
      CommandName.Rename,
      CommandName.Reasoning,
      CommandName.ReadLimit,
    ]);
  });

  it('fuzzily surfaces a command by a hyphen segment of its name', () => {
    // "lazy" isn't a whole-name prefix (the command starts with "toggle-"), but
    // matches the "lazy" segment of toggle-lazy-tool-loading.
    expect(filterCommands('lazy').map((command) => command.name)).toContain(
      CommandName.LazyToolLoading
    );
    // "refresh" matches the trailing segment of local-model-refresh.
    expect(filterCommands('refresh').map((command) => command.name)).toContain(
      CommandName.LocalRefresh
    );
  });

  it('parses slash command input', () => {
    expect(parseCommandInput('/reset')).toBe('reset');
    expect(parseCommandInput('reset')).toBeNull();
  });

  it('filters a caller-provided command list (e.g. built-ins + skill commands)', () => {
    const palette = [
      { name: CommandName.Models as string, description: 'built-in' },
      { name: 'scan', description: 'Review a resume' },
      { name: 'test-skill:review', description: 'Namespaced skill command' },
    ];
    expect(filterCommands('scan', palette).map((c) => c.name)).toEqual([
      'scan',
    ]);
    // "review" matches the command segment after the skill namespace.
    expect(filterCommands('review', palette).map((c) => c.name)).toEqual([
      'test-skill:review',
    ]);
    expect(filterCommands('', palette)).toHaveLength(palette.length);
  });
});
