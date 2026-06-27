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

  it('filters commands by prefix', () => {
    expect(filterCommands('re').map((command) => command.name)).toEqual([
      CommandName.Reasoning,
      CommandName.ReadLimit,
      CommandName.Reset,
    ]);
  });

  it('parses slash command input', () => {
    expect(parseCommandInput('/reset')).toBe('reset');
    expect(parseCommandInput('reset')).toBeNull();
  });
});
