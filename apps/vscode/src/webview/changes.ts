import { diffLines } from 'diff';

import {
  WebviewRole,
  type WebviewDiff,
  type WebviewMessage,
} from '@ext/shared/protocol';
import type { ToolActivity } from '@ext/webview/state';

/**
 * One file's net change for the latest turn that touched it, aggregated from
 * every tool diff of that turn. `baseline` is the file's content right before
 * the turn's first edit, `current` is its latest proposed content — so the
 * +/- counts and the inline diff reflect what the model just changed, not the
 * whole session's cumulative history (a long or resumed session would
 * otherwise keep diffing against content from way back).
 */
export interface ChangedFile {
  path: string;
  /** Content before the latest turn's first edit; '' when it created the file. */
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
 * chronological order; edits within one turn aggregate (first edit fixes the
 * baseline, later ones advance the current content), but a later turn touching
 * the file re-baselines the row to the content right before that turn's first
 * edit — so the panel always shows what changed *now*, not the session's
 * cumulative history.
 *
 * `resolved` maps a path to where the user last kept/undid it. A file is hidden
 * while its edit count hasn't advanced past that mark; once it has, the panel
 * diffs from the resolution's recorded baseline when the resolution happened
 * within the current turn (an older one is superseded by the turn re-baseline).
 */
export function deriveChangedFiles(
  messages: WebviewMessage[],
  liveTools: ToolActivity[],
  resolved: ReadonlyMap<string, ResolvedFile>,
  /**
   * Workspace path of the edit currently awaiting approval, if any. Its diff is
   * only a preview until the user accepts, so it's held out of the panel — once
   * accepted the approval clears and the diff folds in; once rejected the tool's
   * error flag keeps it out.
   */
  pendingApprovalPath?: string
): ChangedFile[] {
  const order: string[] = [];
  const byPath = new Map<
    string,
    {
      baseline: string;
      current: string;
      count: number;
      // Turn the current baseline was taken from (its first edit's oldText).
      turn: number;
      // How many edits had landed before that baseline was taken, so a
      // resolution can be told apart as older/newer than the re-baseline.
      countAtBaseline: number;
      // Content the file held right before its most recent deletion (the
      // deleting diff's old text). Lets a deletion be shown and restored to
      // exactly what was removed, even if the file was also edited first.
      lastDeletedFrom: string;
    }
  >();

  const fold = (diff: WebviewDiff | undefined, turn: number): void => {
    if (!diff) return;
    const existing = byPath.get(diff.path);
    const deletedFrom =
      diff.newText === '' && diff.oldText !== '' ? diff.oldText : '';
    if (existing) {
      // A later turn re-baselines the row to the file's content right before
      // its first edit of that turn. Earlier turns' changes drop out of the
      // diff — and because the baseline is taken from what's on disk *now*,
      // manual edits, git operations, or other sessions' changes made in
      // between never get attributed to this turn either.
      if (turn > existing.turn) {
        existing.turn = turn;
        existing.baseline = diff.oldText;
        existing.countAtBaseline = existing.count;
      }
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
      turn,
      countAtBaseline: 0,
      lastDeletedFrom: deletedFrom,
    });
  };

  // Only fold diffs from edits that actually landed on disk. A rejected/failed
  // call (`isError`) and the one still awaiting approval carry a preview diff
  // that was never applied, so they must not count toward the changes panel.
  // Each user message starts a new turn, which re-baselines the files it edits.
  let turnIndex = 0;
  for (const message of messages) {
    if (message.role === WebviewRole.User) {
      turnIndex += 1;
      continue;
    }
    if (message.toolView?.isError) continue;
    fold(message.toolView?.diff, turnIndex);
  }
  // Live tools always belong to the newest turn.
  for (const tool of liveTools) {
    if (tool.isError) continue;
    if (
      pendingApprovalPath !== undefined &&
      !tool.done &&
      tool.view.path === pendingApprovalPath
    ) {
      continue;
    }
    fold(tool.view.diff, turnIndex);
  }

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

    // After a keep/undo, diff against the state that resolution left on disk —
    // but only when the resolution happened within the current turn (i.e.
    // after the edit the baseline was taken from). An older resolution is
    // superseded by the turn re-baseline.
    const baseline =
      resolvedAt && resolvedAt.editCount > entry.countAtBaseline
        ? resolvedAt.baseline
        : entry.baseline;
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
