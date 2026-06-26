import { diffLines } from 'diff';
import chalk from 'chalk';

import type { ToolDiff } from '@core/ports/tool';

/** Lines of unchanged context to keep around each change. */
const CONTEXT_LINES = 3;
/** Cap diff output so a change scattered across a huge file can't flood. */
const MAX_DIFF_LINES = 40;

type DiffLineKind = 'add' | 'del' | 'context';
interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/**
 * Render a before/after diff as a git-style colored block: green `+` additions,
 * red `-` deletions, dim unchanged context. Only the changed lines and a few
 * lines of surrounding context are shown — long unchanged runs are collapsed to
 * a `⋯ N unchanged lines` marker, so editing one line of a large file produces a
 * compact hunk rather than dumping the whole file. Returns an ANSI string
 * suitable for a `<text>` (which passes ANSI through untouched).
 */
export function renderDiff(diff: ToolDiff): string {
  const lines = toDiffLines(diff);

  // Keep every changed line plus CONTEXT_LINES on either side.
  const keep = new Array<boolean>(lines.length).fill(false);
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.kind === 'context') continue;
    const from = Math.max(0, index - CONTEXT_LINES);
    const to = Math.min(lines.length - 1, index + CONTEXT_LINES);
    for (let j = from; j <= to; j += 1) keep[j] = true;
  }

  // Emit kept lines; collapse each run of dropped lines into one marker.
  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    if (keep[index]) {
      out.push(formatLine(lines[index] as DiffLine));
      index += 1;
      continue;
    }
    let skipped = 0;
    while (index < lines.length && !keep[index]) {
      skipped += 1;
      index += 1;
    }
    out.push(
      chalk.dim(`  ⋯ ${skipped} unchanged line${skipped === 1 ? '' : 's'}`)
    );
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

/** Flatten the diff parts into a typed, per-line list. */
function toDiffLines(diff: ToolDiff): DiffLine[] {
  const lines: DiffLine[] = [];
  for (const part of diffLines(diff.oldText, diff.newText)) {
    const partLines = part.value.split('\n');
    // diffLines keeps a trailing newline on most parts, yielding a spurious
    // empty final element; drop it so we don't render a blank phantom line.
    if (partLines.length > 0 && partLines[partLines.length - 1] === '') {
      partLines.pop();
    }
    const kind: DiffLineKind = part.added
      ? 'add'
      : part.removed
        ? 'del'
        : 'context';
    for (const text of partLines) lines.push({ kind, text });
  }
  return lines;
}

function formatLine(line: DiffLine): string {
  if (line.kind === 'add') return chalk.green(`+ ${line.text}`);
  if (line.kind === 'del') return chalk.red(`- ${line.text}`);
  return chalk.dim(`  ${line.text}`);
}
