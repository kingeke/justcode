import { diffLines } from 'diff';

import type { WebviewDiff, WebviewMessage } from '@ext/shared/protocol';
import type { ToolActivity } from '@ext/webview/state';

/**
 * One file's net change across the whole session, aggregated from every tool
 * diff that touched it. `baseline` is the file's content before the session's
 * first edit, `current` is its latest proposed content — so the +/- counts and
 * the inline diff reflect the cumulative change, not the last individual edit.
 */
export interface ChangedFile {
  path: string;
  /** Content before the first edit this session; '' when the file was created. */
  baseline: string;
  /** Latest content after the most recent edit. */
  current: string;
  /** True when the file didn't exist before this session (baseline is empty). */
  created: boolean;
  /** True when the file existed but has been deleted (current is empty). */
  deleted: boolean;
  added: number;
  removed: number;
  /**
   * How many edits have touched this file so far. Used as a resolution marker:
   * keeping/undoing a file records its count, and a later edit bumps it past
   * that mark so the file resurfaces — even if the new content matches what was
   * resolved (e.g. the user undid a change, then asked the model to redo it).
   */
  editCount: number;
}

/**
 * A file the user has kept or undone, marking where the changes panel should
 * pick up from next time the file changes.
 */
export interface ResolvedFile {
  /** Edit count at which it was resolved; a later edit unhides the file. */
  editCount: number;
  /**
   * The on-disk content the resolution left behind, used as the baseline for
   * subsequent changes. For Keep this is the accepted content; for Undo it's
   * the content the file was reverted to — so the panel shows only what's new
   * since, not the whole session history.
   */
  baseline: string;
}

/**
 * Collapses every file-changing tool diff in the transcript (and any live,
 * in-flight tool activity) into one row per path. Diffs are visited in
 * chronological order so the first occurrence of a path fixes its baseline and
 * later ones advance the current content.
 *
 * `resolved` maps a path to where the user last kept/undid it. A file is hidden
 * while its edit count hasn't advanced past that mark; once it has, the panel
 * diffs from the resolution's recorded baseline rather than the original.
 */
export function deriveChangedFiles(
  messages: WebviewMessage[],
  liveTools: ToolActivity[],
  resolved: ReadonlyMap<string, ResolvedFile>
): ChangedFile[] {
  const order: string[] = [];
  const byPath = new Map<
    string,
    {
      baseline: string;
      current: string;
      count: number;
      // Content the file held right before its most recent deletion (the
      // deleting diff's old text). Lets a deletion be shown and restored to
      // exactly what was removed, even if the file was also edited first.
      lastDeletedFrom: string;
    }
  >();

  const fold = (diff: WebviewDiff | undefined): void => {
    if (!diff) return;
    const existing = byPath.get(diff.path);
    const deletedFrom = diff.newText === '' && diff.oldText !== '' ? diff.oldText : '';
    if (existing) {
      existing.current = diff.newText;
      existing.count += 1;
      if (deletedFrom) existing.lastDeletedFrom = deletedFrom;
      return;
    }
    order.push(diff.path);
    byPath.set(diff.path, {
      baseline: diff.oldText,
      current: diff.newText,
      count: 1,
      lastDeletedFrom: deletedFrom,
    });
  };

  for (const message of messages) fold(message.toolView?.diff);
  for (const tool of liveTools) fold(tool.view.diff);

  const files: ChangedFile[] = [];
  for (const path of order) {
    const entry = byPath.get(path);
    if (!entry) continue;
    // Hidden while no edit has landed since the user resolved it.
    const resolvedAt = resolved.get(path);
    if (resolvedAt !== undefined && entry.count <= resolvedAt.editCount) {
      continue;
    }

    // A deletion is its own kind of change: always show it (even for a file
    // created earlier this session, whose net change would otherwise be zero),
    // and treat the content present right before the delete as the baseline so
    // Restore puts that content back.
    const deleted = entry.current === '' && entry.lastDeletedFrom !== '';
    if (deleted) {
      const baseline = entry.lastDeletedFrom;
      const { added, removed } = countLineChanges(baseline, '');
      files.push({
        path,
        baseline,
        current: '',
        created: false,
        deleted: true,
        added,
        removed,
        editCount: entry.count,
      });
      continue;
    }

    // After a keep/undo, diff against the state that resolution left on disk
    // rather than the original session baseline.
    const baseline = resolvedAt ? resolvedAt.baseline : entry.baseline;
    // A no-op (the model rewrote the file back to the last resolved content)
    // shouldn't clutter the panel.
    if (baseline === entry.current) continue;
    const { added, removed } = countLineChanges(baseline, entry.current);
    files.push({
      path,
      baseline,
      current: entry.current,
      created: baseline === '',
      deleted: false,
      added,
      removed,
      editCount: entry.count,
    });
  }
  return files;
}

/** Sums added/removed line counts the same way the inline diff renders them. */
function countLineChanges(
  oldText: string,
  newText: string
): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const part of diffLines(oldText, newText)) {
    if (!part.added && !part.removed) continue;
    // `count` is the number of lines in the part; fall back to splitting when
    // the diff library omits it.
    const lines = part.count ?? part.value.split('\n').length;
    if (part.added) added += lines;
    else if (part.removed) removed += lines;
  }
  return { added, removed };
}

/** Totals across all changed files, for the panel's summary header. */
export function summarizeChanges(files: ChangedFile[]): {
  added: number;
  removed: number;
} {
  return files.reduce(
    (totals, file) => ({
      added: totals.added + file.added,
      removed: totals.removed + file.removed,
    }),
    { added: 0, removed: 0 }
  );
}
