/**
 * The composer's `/` command completions: which part of the draft is an active
 * slash-command query, and how the installed skill commands rank against it.
 * Mirrors the CLI palette's ranking (exact > whole-name prefix > hyphen-segment
 * prefix > substring) so the two surfaces suggest in the same order.
 */

import type { WebviewSkillCommand } from '@ext/shared/protocol';

/**
 * The active slash-command query, or undefined when the draft isn't one. A
 * draft is a command query only while it's a single leading `/token` — once a
 * space is typed the command is chosen and the rest is arguments.
 */
export function getActiveSlashQuery(value: string): string | undefined {
  if (!value.startsWith('/')) return undefined;
  if (/\s/.test(value)) return undefined;
  return value.slice(1);
}

export function filterSkillCommands(
  commands: readonly WebviewSkillCommand[],
  query: string
): WebviewSkillCommand[] {
  const lower = query.toLowerCase().trim();
  if (!lower) return [...commands];
  return commands
    .map((command, index) => ({
      command,
      index,
      score: scoreName(command.name, lower),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.command);
}

function scoreName(name: string, query: string): number {
  if (name === query) return 1000;
  if (name.startsWith(query)) return 500;
  if (name.split(/[-:]/).some((segment) => segment.startsWith(query))) {
    return 300;
  }
  if (name.includes(query)) return 200;
  return 0;
}
