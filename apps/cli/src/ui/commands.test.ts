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

  it('ranks prefix matches ahead of fuzzy matches', () => {
    // Whole-name prefix matches come first, in declaration order; segment/
    // substring matches (e.g. "refresh" in local-model-refresh) follow.
    expect(
      filterCommands('re')
        .map((command) => command.name)
        .slice(0, 4)
    ).toEqual([
      CommandName.RefreshModels,
      CommandName.Reasoning,
      CommandName.ReadLimit,
      CommandName.Reset,
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
});
