import { diffLines } from 'diff';
import chalk from 'chalk';

import type { ToolDiff } from '@core/ports/tool';

/** Cap diff output so a large edit can't flood the terminal. */
const MAX_DIFF_LINES = 40;

/**
 * Render a before/after diff as a git-style colored block: green `+` additions,
 * red `-` deletions, dim unchanged context. Returns an ANSI string suitable for
 * an Ink `<Text>` (which passes ANSI through untouched).
 */
export function renderDiff(diff: ToolDiff): string {
  const parts = diffLines(diff.oldText, diff.newText);
  const out: string[] = [];

  for (const part of parts) {
    const lines = part.value.split('\n');
    // diffLines keeps a trailing newline on most parts, yielding a spurious
    // empty final element; drop it so we don't render a blank phantom line.
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    for (const line of lines) {
      if (part.added) {
        out.push(chalk.green(`+ ${line}`));
      } else if (part.removed) {
        out.push(chalk.red(`- ${line}`));
      } else {
        out.push(chalk.dim(`  ${line}`));
      }
    }
  }

  if (out.length <= MAX_DIFF_LINES) {
    return out.join('\n');
  }
  const hidden = out.length - MAX_DIFF_LINES;
  return [
    ...out.slice(0, MAX_DIFF_LINES),
    chalk.dim(`… (${hidden} more lines)`),
  ].join('\n');
}
