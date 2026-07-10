import * as React from 'react';

import {
  WebviewSubAgentStatus,
  type WebviewMessage,
} from '@ext/shared/protocol';
import { RobotIcon } from '@ext/webview/components/Icons';
import { MessageView, formatTime } from '@ext/webview/components/MessageView';
import type { SubAgentRunView } from '@ext/webview/state';

/**
 * Live view of the sub agents spawned by the current turn's `task` calls,
 * rendered above the composer while any exist. Each row shows the run's
 * status, type, description, tool-use count, and — while running — its latest
 * activity; clicking a row opens the full-transcript popup.
 */
export function SubAgentPanel({
  runs,
  onOpen,
}: {
  runs: SubAgentRunView[];
  onOpen: (runId: string) => void;
}): React.JSX.Element | null {
  if (runs.length === 0) return null;

  return (
    <div className="subagents">
      <div className="subagents-header">
        {runs.length} sub agent{runs.length === 1 ? '' : 's'}
      </div>
      <ul className="subagents-list">
        {/* Newest first, matching the robot popup's ordering. */}
        {[...runs].reverse().map((run) => (
          <li key={run.runId} className="subagents-row-wrap">
            <div
              className="subagents-row is-expandable"
              onClick={() => onOpen(run.runId)}
              title="Show the sub agent’s full conversation"
            >
              <span
                className={`subagents-status subagents-status-${run.status}`}
              >
                {statusGlyph(run.status)}
              </span>
              <span className="subagents-type">{run.agentType}</span>
              <span className="subagents-desc">{run.description}</span>
              {run.model ? (
                <span className="subagents-model">
                  {run.providerId ? `${run.providerId} · ` : ''}
                  {run.model}
                </span>
              ) : null}
              <span className="subagents-meta">
                {run.toolUseCount > 0
                  ? `${run.toolUseCount} tool use${run.toolUseCount === 1 ? '' : 's'}`
                  : ''}
                {run.status === WebviewSubAgentStatus.Running
                  ? ` · ${run.latestActivity ?? 'starting…'}`
                  : run.endedAt
                    ? ` · ${elapsedLabel(run.startedAt, run.endedAt)}`
                    : ''}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A robot button stacked with the transcript's floating buttons, shown when
 * the conversation has sub agent runs (live or persisted). Hovering it pops up
 * a card listing every run; clicking one opens its full-transcript modal.
 * Reuses the conversation-sidebar hover-popup styles so the button group
 * stays visually consistent.
 */
export function SubAgentSidebar({
  runs,
  onOpen,
  stackedButtons = 0,
}: {
  runs: SubAgentRunView[];
  onOpen: (runId: string) => void;
  /** How many floating buttons are stacked below this one (0–3). */
  stackedButtons?: number;
}): React.JSX.Element | null {
  // Click (not hover) reveals the panel; a click outside or Escape closes it —
  // matching the "Your messages" sidebar.
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (runs.length === 0) return null;

  return (
    <div
      ref={rootRef}
      className={`conversation-sidebar subagent-sidebar conversation-sidebar-raised-${stackedButtons}${open ? ' is-open' : ''}`}
    >
      <button
        type="button"
        className="conversation-sidebar-tab"
        aria-label="Sub agents"
        aria-expanded={open}
        title="Sub agents"
        onClick={() => setOpen((current) => !current)}
      >
        <RobotIcon size={14} />
      </button>

      <div className="conversation-sidebar-panel" role="menu">
        <div className="conversation-sidebar-header">
          <span className="conversation-sidebar-title">Sub agents</span>
        </div>

        <div className="conversation-sidebar-list">
          {/* Newest first, so the latest runs sit at the top of the popup. */}
          {[...runs].reverse().map((run) => (
            <button
              key={run.runId}
              type="button"
              className="conversation-sidebar-item"
              onClick={(event) => {
                // Drop focus and close the panel before opening the run.
                event.currentTarget.blur();
                setOpen(false);
                onOpen(run.runId);
              }}
            >
              <span className="conversation-sidebar-item-title">
                <span
                  className={`subagents-status subagents-status-${run.status}`}
                >
                  {statusGlyph(run.status)}
                </span>{' '}
                {run.description}
              </span>
              <span className="conversation-sidebar-item-meta">
                {run.agentType}
                {run.toolUseCount > 0
                  ? ` · ${run.toolUseCount} tool use${run.toolUseCount === 1 ? '' : 's'}`
                  : ''}
                {/* When the sub agent was called, like the messages popup. */}
                {startedLabel(run.startedAt)
                  ? ` · ${startedLabel(run.startedAt)}`
                  : ''}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Full-screen popup showing one sub agent run's whole conversation (the
 * delegated prompt, every step it took, tool results, and its final report),
 * rendered with the same message components as the main transcript. Stays live
 * for running sub agents: the host re-sends the transcript as it grows.
 * Closed with the × button, Esc, or a click on the backdrop.
 */
export function SubAgentTranscriptModal({
  run,
  messages,
  onClose,
  onOpenFile,
}: {
  run: SubAgentRunView;
  messages: WebviewMessage[] | undefined;
  onClose: () => void;
  onOpenFile: (path: string) => void;
}): React.JSX.Element {
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="subagent-modal-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div className="subagent-modal" onClick={(e) => e.stopPropagation()}>
        <div className="subagent-modal-header">
          <span className={`subagents-status subagents-status-${run.status}`}>
            {statusGlyph(run.status)}
          </span>
          <span className="subagents-type">{run.agentType}</span>
          <span className="subagent-modal-title">{run.description}</span>
          {run.model ? (
            <span className="subagents-model">
              {run.providerId ? `${run.providerId} · ` : ''}
              {run.model}
            </span>
          ) : null}
          <button
            type="button"
            className="subagent-modal-close"
            title="Close (Esc)"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="subagent-modal-body">
          {messages === undefined ? (
            <div className="subagent-modal-empty">Loading transcript…</div>
          ) : messages.length === 0 ? (
            <div className="subagent-modal-empty">No messages yet.</div>
          ) : (
            messages.map((message) => (
              <MessageView
                key={message.id}
                message={message}
                expandTools={false}
                onOpenFile={onOpenFile}
              />
            ))
          )}
          {run.status === WebviewSubAgentStatus.Running ? (
            <div className="subagent-modal-live">
              working… {run.latestActivity ?? ''}
            </div>
          ) : null}
        </div>
        <SubAgentMetricsFooter run={run} />
      </div>
    </div>
  );
}

/**
 * The run's own footer: ctx/in/cached/out/cost plus TTFT and avg toks/s —
 * scoped to just this sub agent, mirroring the main session footer. Renders
 * nothing until the run has reported usage or stats.
 */
function SubAgentMetricsFooter({
  run,
}: {
  run: SubAgentRunView;
}): React.JSX.Element {
  const { usage, stats } = run;
  const parts: string[] = [
    `ctx ${(stats?.lastInputTokens ?? 0).toLocaleString()}`,
    `in ${(usage?.inputTokens ?? 0).toLocaleString()}`,
    `cached ${(usage?.cachedTokens ?? 0).toLocaleString()}`,
    `out ${(usage?.outputTokens ?? 0).toLocaleString()}`,
  ];
  if (usage?.cost != null && usage.cost > 0) {
    parts.push(`$${usage.cost.toFixed(4)}`);
  }
  if (stats?.ttftMs !== undefined) {
    parts.push(`TTFT ${formatDurationMs(stats.ttftMs)}`);
  }
  if (stats?.tokensPerSecond !== undefined) {
    parts.push(`${stats.tokensPerSecond.toFixed(1)} tok/s`);
  }
  if (stats?.avgTokensPerSecond !== undefined) {
    parts.push(`AVG ${stats.avgTokensPerSecond.toFixed(1)}`);
  }
  return <div className="subagent-modal-metrics">{parts.join('  ·  ')}</div>;
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    const rounded = Math.round(totalSeconds * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return seconds > 0 ? `${minutes}min ${seconds}s` : `${minutes}min`;
}

function statusGlyph(status: WebviewSubAgentStatus): string {
  switch (status) {
    case WebviewSubAgentStatus.Running:
      return '◐';
    case WebviewSubAgentStatus.Completed:
      return '●';
    case WebviewSubAgentStatus.Failed:
      return '✗';
    case WebviewSubAgentStatus.Aborted:
      return '○';
  }
}

/** Formats a run's epoch-ms start as a local hour:minute time ('' if invalid). */
function startedLabel(startedAt: number): string {
  if (!Number.isFinite(startedAt) || startedAt <= 0) return '';
  return formatTime(new Date(startedAt).toISOString());
}

function elapsedLabel(startedAt: number, endedAt: number): string {
  const totalSeconds = Math.max(1, Math.round((endedAt - startedAt) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
