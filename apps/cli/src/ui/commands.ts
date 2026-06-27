export enum CommandName {
  Connect = 'connect',
  Models = 'models',
  Sessions = 'sessions',
  NewSession = 'new-session',
  Clear = 'clear',
  Thinking = 'thinking',
  AutoWrites = 'auto-writes',
  ExpandTools = 'expand-tools',
  ReadLimit = 'read-limit',
  Config = 'config',
  Reset = 'reset',
}

export interface Command {
  name: CommandName;
  description: string;
}

export const COMMANDS: Command[] = [
  {
    name: CommandName.Connect,
    description: 'Search providers and connect to one',
  },
  {
    name: CommandName.Models,
    description: 'Browse and switch the active model',
  },
  {
    name: CommandName.Sessions,
    description: 'Browse saved sessions and resume one',
  },
  {
    name: CommandName.NewSession,
    description: 'Start a fresh conversation in a new session',
  },
  {
    name: CommandName.Clear,
    description: 'Clear the current session and start fresh',
  },
  {
    name: CommandName.Thinking,
    description: 'Toggle whether model reasoning is shown',
  },
  {
    name: CommandName.AutoWrites,
    description: 'Toggle auto-applying file writes without confirmation',
  },
  {
    name: CommandName.ExpandTools,
    description: 'Toggle showing full tool input/output inline by default',
  },
  {
    name: CommandName.ReadLimit,
    description:
      'Set how many lines of a file the model reads at once, e.g. /read-limit 500',
  },
  {
    name: CommandName.Config,
    description: 'Open the config file in your editor',
  },
  {
    name: CommandName.Reset,
    description: 'Reset app defaults and clear connected providers and models',
  },
];

export function filterCommands(query: string): Command[] {
  const lower = query.toLowerCase();
  return COMMANDS.filter((cmd) => cmd.name.startsWith(lower));
}

export function parseCommandInput(input: string): string | null {
  if (!input.startsWith('/')) return null;
  return input.slice(1).trim();
}

export function isCommandName(value: string): value is CommandName {
  return COMMANDS.some((command) => command.name === value);
}
