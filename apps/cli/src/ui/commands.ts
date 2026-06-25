export interface Command {
  name: string;
  description: string;
}

export const COMMANDS: Command[] = [
  {
    name: 'connect',
    description: 'Search providers and connect to one',
  },
  {
    name: 'models',
    description: 'Browse and switch the active model',
  },
  {
    name: 'sessions',
    description: 'Browse saved sessions and resume one',
  },
  {
    name: 'new-session',
    description: 'Start a fresh conversation in a new session',
  },
  {
    name: 'clear',
    description: 'Clear the current session and start fresh',
  },
  {
    name: 'thinking',
    description: 'Toggle whether model reasoning is shown',
  },
  {
    name: 'auto-writes',
    description: 'Toggle auto-applying file writes without confirmation',
  },
  {
    name: 'expand-tools',
    description: 'Toggle showing full tool input/output inline by default',
  },
  {
    name: 'read-limit',
    description:
      'Set how many lines of a file the model reads at once, e.g. /read-limit 500',
  },
  {
    name: 'config',
    description: 'Open the config file in your editor',
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
