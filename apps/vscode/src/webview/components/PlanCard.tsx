import * as React from 'react';

import { renderMarkdown } from '@ext/webview/markdown';

/**
 * Writes a plan's Markdown source to the clipboard, unchanged — the plan as it
 * was presented, so it can be pasted into an issue, a doc or another tool.
 * Resolves false when the webview has no clipboard access.
 */
export async function copyPlanText(plan: string): Promise<boolean> {
  if (!navigator.clipboard) return false;
  await navigator.clipboard.writeText(plan);
  return true;
}

/**
 * Renders a presented plan (a present_plan tool result) as its own card: the
 * plan markdown plus, on the most recent plan when idle, the Start/Edit/Copy
 * actions.
 */
export function PlanCard({
  plan,
  showActions,
  onStart,
  onEdit,
}: {
  plan: string;
  showActions: boolean;
  onStart: () => void;
  onEdit: () => void;
}): React.JSX.Element {
  // Copy feedback for the Copy plan button. Copies the plan's Markdown source
  // as-is (not the rendered HTML), so it can be pasted into an issue, a doc or
  // another tool unchanged.
  const [copied, setCopied] = React.useState(false);
  const copyPlan = (): void => {
    void copyPlanText(plan).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="plan-card">
      <div className="plan-card-label">Plan</div>
      <div
        className="plan-card-body markdown-body"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(plan) }}
      />
      {showActions ? (
        <div className="plan-actions">
          <button
            type="button"
            className="plan-start-btn"
            onClick={onStart}
            title="Switch to Build mode and implement this plan"
          >
            Start implementation →
          </button>
          <button
            type="button"
            className="plan-edit-btn"
            onClick={onEdit}
            title="Save the plan to a markdown file to edit before implementing"
          >
            Edit plan
          </button>
          <button
            type="button"
            className="plan-copy-btn"
            onClick={copyPlan}
            title="Copy the plan as Markdown"
          >
            {copied ? 'Copied' : 'Copy plan'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
