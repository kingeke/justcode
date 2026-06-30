import * as React from 'react';

import type { ChangedFile } from '@ext/webview/changes';
import { summarizeChanges } from '@ext/webview/changes';
import { DiffView } from '@ext/webview/components/DiffView';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  PlusIcon,
  TrashIcon,
  UndoIcon,
} from '@ext/webview/components/Icons';

/**
 * A consolidated, session-wide review panel of every file the agent edited or
 * created, mirroring the per-message diffs into one place. Each file can be
 * Kept (accepted, removed from the panel) or Undone (reverted on disk via the
 * host), with Keep all / Undo all acting on every still-pending file.
 * Ctrl/Cmd-clicking a file name opens it in the editor.
 */
export function ChangesPanel({
  files,
  error,
  onKeep,
  onUndo,
  onKeepAll,
  onUndoAll,
  onOpenFile,
}: {
  files: ChangedFile[];
  error?: string | undefined;
  onKeep: (file: ChangedFile) => void;
  onUndo: (file: ChangedFile) => void;
  onKeepAll: () => void;
  onUndoAll: () => void;
  onOpenFile: (path: string) => void;
}): React.JSX.Element | null {
  const [collapsed, setCollapsed] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  if (files.length === 0) return null;

  const totals = summarizeChanges(files);

  return (
    <div className="changes">
      <div className="changes-header">
        <button
          type="button"
          className="changes-toggle"
          onClick={() => setCollapsed((value) => !value)}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          <span className={`changes-caret${collapsed ? ' is-collapsed' : ''}`}>
            {collapsed ? (
              <ChevronLeftIcon size={14} />
            ) : (
              <ChevronDownIcon size={14} />
            )}
          </span>
          <span className="changes-summary">
            {files.length} file{files.length === 1 ? '' : 's'} changed
          </span>
          <span className="changes-stat changes-added">+{totals.added}</span>
          <span className="changes-stat changes-removed">
            −{totals.removed}
          </span>
        </button>
        <div className="changes-actions">
          <button
            type="button"
            className="changes-btn"
            onClick={onKeepAll}
            title="Keep all changes"
          >
            Keep all
          </button>
          <button
            type="button"
            className="changes-btn"
            onClick={onUndoAll}
            title="Undo all changes"
          >
            Undo all
          </button>
        </div>
      </div>

      {collapsed ? null : (
        <ul className="changes-list">
          {files.map((file) => (
            <li key={file.path} className="changes-row">
              {/* Clicking the row toggles the inline diff; the filename itself
                  opens the file, so it stops propagation. */}
              <div
                className="changes-row-main"
                onClick={() =>
                  setExpanded((current) =>
                    current === file.path ? null : file.path
                  )
                }
                title="Click to toggle diff"
              >
                {file.created ? (
                  <span className="changes-badge" title="New file">
                    <PlusIcon size={12} />
                  </span>
                ) : null}
                {file.deleted ? (
                  <span
                    className="changes-badge changes-badge-deleted"
                    title="Deleted file"
                  >
                    <TrashIcon size={12} />
                  </span>
                ) : null}
                {file.deleted ? (
                  <span className="changes-name is-deleted">
                    {basename(file.path)}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="changes-name changes-name-link"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenFile(file.path);
                    }}
                    title={`Open ${file.path}`}
                  >
                    {basename(file.path)}
                  </button>
                )}
                <span className="changes-dir">{dirname(file.path)}</span>
                <span className="changes-stat changes-added">
                  +{file.added}
                </span>
                <span className="changes-stat changes-removed">
                  −{file.removed}
                </span>
                <button
                  type="button"
                  className="changes-icon-btn"
                  onClick={(event) => {
                    event.stopPropagation();
                    onKeep(file);
                  }}
                  title="Keep"
                >
                  <CheckIcon size={15} />
                </button>
                <button
                  type="button"
                  className="changes-icon-btn"
                  onClick={(event) => {
                    event.stopPropagation();
                    onUndo(file);
                  }}
                  title={file.deleted ? 'Restore' : 'Undo'}
                >
                  <UndoIcon size={15} />
                </button>
              </div>
              {expanded === file.path ? (
                <DiffView
                  diff={{
                    path: file.path,
                    oldText: file.baseline,
                    newText: file.current,
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {error ? <div className="changes-error">{error}</div> : null}
    </div>
  );
}

/** Last path segment (the file name). */
function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

/** Everything before the file name; empty for a top-level file. */
function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}
