export enum CommandName {
  Connect = 'connect',
  Models = 'models',
  RefreshModels = 'refresh-models',
  Sessions = 'sessions',
  NewSession = 'new-session',
  Clear = 'clear',
  ClearSessions = 'clear-sessions',
  Thinking = 'thinking',
  Reasoning = 'reasoning',
  AutoApprove = 'auto-approve',
  LocalRefresh = 'local-model-refresh',
  LazyToolLoading = 'toggle-lazy-tool-loading',
  ExpandTools = 'expand-tools',
  ManageTools = 'manage-tools',
  ConfigureMcpServers = 'configure-mcp-servers',
  ReadLimit = 'read-limit',
  ContextWindow = 'context-window',
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
    name: CommandName.RefreshModels,
    description: 'Re-fetch every provider model list, bypassing the cache',
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
    name: CommandName.ClearSessions,
    description: 'Delete all saved sessions',
  },
  {
    name: CommandName.Thinking,
    description: 'Toggle whether model reasoning is shown',
  },
  {
    name: CommandName.Reasoning,
    description: 'Choose reasoning effort for the current model',
  },
  {
    name: CommandName.AutoApprove,
    description: 'Toggle auto-approving all tool actions without confirmation',
  },
  {
    name: CommandName.LocalRefresh,
    description: 'Toggle always refreshing local models (off uses daily cache)',
  },
  {
    name: CommandName.LazyToolLoading,
    description: 'Toggle lazy tool loading (off sends all tools by default)',
  },
  {
    name: CommandName.ExpandTools,
    description: 'Toggle showing full tool input/output inline by default',
  },
  {
    name: CommandName.ManageTools,
    description: 'Turn individual tools on or off',
  },
  {
    name: CommandName.ConfigureMcpServers,
    description: 'Open mcp.json to add or edit MCP servers',
  },
  {
    name: CommandName.ReadLimit,
    description:
      'Set how many lines of a file the model reads at once, e.g. /read-limit 500',
  },
  {
    name: CommandName.ContextWindow,
    description:
      'Set how many recent context window items are sent to the model, e.g. /context-window 50',
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

/**
 * Fuzzily ranks commands against a query so a partial name surfaces the command
 * even when it isn't a prefix — e.g. "lazy" finds `toggle-lazy-tool-loading` via
 * the `lazy` segment. Ranking, best first: exact, whole-name prefix,
 * hyphen-segment prefix, then any substring. Ties keep declaration order. An
 * empty query lists everything.
 */
export function filterCommands(query: string): Command[] {
  const lower = query.toLowerCase().trim();
  if (!lower) return COMMANDS;

  return COMMANDS.map((cmd, index) => ({
    cmd,
    index,
    score: scoreCommand(cmd.name, lower),
  }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.cmd);
}

function scoreCommand(name: string, query: string): number {
  if (name === query) return 1000;
  if (name.startsWith(query)) return 500;
  // A hyphen-delimited segment starts with the query ("lazy" in
  // "toggle-lazy-tool-loading"), the most useful fuzzy hit for these names.
  if (name.split('-').some((segment) => segment.startsWith(query))) return 300;
  if (name.includes(query)) return 200;
  return 0;
}

export function parseCommandInput(input: string): string | null {
  if (!input.startsWith('/')) return null;
  return input.slice(1).trim();
}

export function isCommandName(value: string): value is CommandName {
  return COMMANDS.some((command) => command.name === value);
}
