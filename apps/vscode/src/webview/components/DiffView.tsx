import * as React from 'react';
import { diffLines } from 'diff';

import type { WebviewDiff } from '@ext/shared/protocol';

const CONTEXT_LINES = 3;
const MAX_DIFF_LINES = 40;
const ELLIPSIS = '⋯';

type DiffLineKind = 'add' | 'del' | 'context';

interface RenderedDiffLine {
  kind: DiffLineKind;
  text: string;
}

/**
 * Render a compact git-style diff: changed lines plus a little surrounding
 * context, with long unchanged runs collapsed into an "unchanged lines"
 * marker. This mirrors the CLI closely enough that edits are easy to inspect.
 */
export function DiffView({ diff }: { diff: WebviewDiff }): React.JSX.Element {
  const lines = toRenderedLines(diff);

  return (
    <div className="diff">
      <div className="diff-path">{diff.path}</div>
      <pre className="diff-body">
        {lines.map((line, index) => {
          if (line.kind === 'context') {
            return (
              <div key={`c-${index}`} className="diff-line diff-context">
                <span className="diff-gutter"> </span>
                {line.text}
              </div>
            );
          }

          if (line.kind === 'del') {
            return (
              <div key={`d-${index}`} className="diff-line diff-removed">
                <span className="diff-gutter">-</span>
                {line.text}
              </div>
            );
          }

          return (
            <div key={`a-${index}`} className="diff-line diff-added">
              <span className="diff-gutter">+</span>
              {line.text}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

function toRenderedLines(diff: WebviewDiff): RenderedDiffLine[] {
  const lines = toDiffLines(diff);
  if (lines.length === 0) return [];

  const keep = new Array<boolean>(lines.length).fill(false);

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.kind === 'context') continue;
    const from = Math.max(0, index - CONTEXT_LINES);
    const to = Math.min(lines.length - 1, index + CONTEXT_LINES);
    for (let keepIndex = from; keepIndex <= to; keepIndex += 1) {
      keep[keepIndex] = true;
    }
  }

  const rendered: RenderedDiffLine[] = [];
  let index = 0;
  while (index < lines.length) {
    if (keep[index]) {
      rendered.push(lines[index] as RenderedDiffLine);
      index += 1;
      continue;
    }

    let skipped = 0;
    while (index < lines.length && !keep[index]) {
      skipped += 1;
      index += 1;
    }

    rendered.push({
      kind: 'context',
      text: `${ELLIPSIS} ${skipped} unchanged line${skipped === 1 ? '' : 's'}`,
    });
  }

  if (rendered.length <= MAX_DIFF_LINES) {
    return rendered;
  }

  const hidden = rendered.length - MAX_DIFF_LINES;
  return [
    ...rendered.slice(0, MAX_DIFF_LINES),
    { kind: 'context', text: `${ELLIPSIS} (${hidden} more lines)` },
  ];
}

function toDiffLines(diff: WebviewDiff): RenderedDiffLine[] {
  const lines: RenderedDiffLine[] = [];

  for (const part of diffLines(diff.oldText, diff.newText)) {
    const partLines = part.value.split('\n');
    if (partLines.length > 0 && partLines[partLines.length - 1] === '') {
      partLines.pop();
    }

    const kind: DiffLineKind = part.added
      ? 'add'
      : part.removed
        ? 'del'
        : 'context';

    for (const text of partLines) {
      lines.push({ kind, text });
    }
  }

  return lines;
}
