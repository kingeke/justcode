import * as React from 'react';

import type { WebviewDiff } from '@ext/shared/protocol';

/**
 * A compact line-level diff. We avoid pulling a diff library into the webview:
 * a tool's diff is small (a single edit), so showing the removed block followed
 * by the added block is clear enough and keeps the bundle lean.
 */
export function DiffView({ diff }: { diff: WebviewDiff }): React.JSX.Element {
  const removed = splitLines(diff.oldText);
  const added = splitLines(diff.newText);

  return (
    <div className="diff">
      <div className="diff-path">{diff.path}</div>
      <pre className="diff-body">
        {removed.map((line, i) => (
          <div key={`r-${i}`} className="diff-line diff-removed">
            <span className="diff-gutter">-</span>
            {line}
          </div>
        ))}
        {added.map((line, i) => (
          <div key={`a-${i}`} className="diff-line diff-added">
            <span className="diff-gutter">+</span>
            {line}
          </div>
        ))}
      </pre>
    </div>
  );
}

function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split('\n');
  // Drop a trailing empty line so a file ending in "\n" doesn't render a blank.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}
