import { describe, expect, it } from 'vitest';

import { WebviewRole, type WebviewMessage } from '@ext/shared/protocol';
import { deriveChangedFiles, summarizeChanges } from '@ext/webview/changes';
import type { ToolActivity } from '@ext/webview/state';

function toolMessage(
  path: string,
  oldText: string,
  newText: string
): WebviewMessage {
  return {
    id: `m-${path}-${newText.length}`,
    role: WebviewRole.Tool,
    content: '',
    toolName: 'edit_file',
    toolView: { title: 'Edit', diff: { path, oldText, newText } },
  };
}

function liveTool(
  path: string,
  oldText: string,
  newText: string,
  opts: { done?: boolean; isError?: boolean } = {}
): ToolActivity {
  return {
    toolCallId: `c-${path}`,
    toolName: 'edit_file',
    view: { title: 'Edit', path, diff: { path, oldText, newText } },
    // Default to an applied edit: the panel only counts tools that finished
    // without error, so that's the case most assertions care about.
    done: opts.done ?? true,
    isError: opts.isError ?? false,
  };
}

describe('deriveChangedFiles', () => {
  it('counts added and removed lines for an edit', () => {
    const files = deriveChangedFiles(
      [toolMessage('a.ts', 'one\ntwo\n', 'one\nTWO\nthree\n')],
      [],
      new Map()
    );

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      path: 'a.ts',
      created: false,
      added: 2,
      removed: 1,
      editCount: 1,
    });
  });

  it('marks a file with empty baseline as created', () => {
    const files = deriveChangedFiles(
      [toolMessage('new.ts', '', 'hello\n')],
      [],
      new Map()
    );

    expect(files[0]).toMatchObject({ path: 'new.ts', created: true });
  });

  it('keeps the first baseline and latest content across multiple edits', () => {
    const files = deriveChangedFiles(
      [
        toolMessage('a.ts', 'orig\n', 'mid\n'),
        toolMessage('a.ts', 'mid\n', 'final\n'),
      ],
      [],
      new Map()
    );

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      baseline: 'orig\n',
      current: 'final\n',
      editCount: 2,
    });
  });

  it('folds applied live tool diffs after committed ones', () => {
    const files = deriveChangedFiles(
      [toolMessage('a.ts', 'orig\n', 'mid\n')],
      [liveTool('a.ts', 'mid\n', 'final\n')],
      new Map()
    );

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ baseline: 'orig\n', current: 'final\n' });
  });

  it('ignores the edit currently awaiting approval', () => {
    const files = deriveChangedFiles(
      [],
      [liveTool('a.ts', 'orig\n', 'edited\n', { done: false })],
      new Map(),
      'a.ts' // this file's edit is the one awaiting approval
    );

    expect(files).toHaveLength(0);
  });

  it('shows an accepted edit immediately, before it reports done', () => {
    // After Accept the approval clears (no pendingApprovalPath); the edit is
    // applying but may not have reported `done` yet — it must still show.
    const files = deriveChangedFiles(
      [],
      [liveTool('a.ts', 'orig\n', 'edited\n', { done: false })],
      new Map()
    );

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: 'a.ts', current: 'edited\n' });
  });

  it('ignores a rejected or failed live tool preview', () => {
    const files = deriveChangedFiles(
      [],
      [liveTool('a.ts', 'orig\n', 'edited\n', { done: true, isError: true })],
      new Map()
    );

    expect(files).toHaveLength(0);
  });

  it('ignores a rejected committed tool message', () => {
    const rejected: WebviewMessage = {
      id: 'm-rejected',
      role: WebviewRole.Tool,
      content: 'The user rejected this tool call.',
      toolName: 'edit_file',
      toolView: {
        title: 'Edit',
        diff: { path: 'a.ts', oldText: 'orig\n', newText: 'edited\n' },
        isError: true,
      },
    };
    const files = deriveChangedFiles([rejected], [], new Map());

    expect(files).toHaveLength(0);
  });

  it('omits files resolved at their current edit count', () => {
    const files = deriveChangedFiles(
      [toolMessage('a.ts', 'x\n', 'y\n'), toolMessage('b.ts', 'p\n', 'q\n')],
      [],
      new Map([['a.ts', { editCount: 1, baseline: 'y\n' }]])
    );

    expect(files.map((file) => file.path)).toEqual(['b.ts']);
  });

  it('resurfaces a kept file once a new edit lands, diffed from the kept state', () => {
    // The user kept a.ts at edit #1 (content "first"), then the model edited it.
    const files = deriveChangedFiles(
      [
        toolMessage('a.ts', 'orig\n', 'first\n'),
        toolMessage('a.ts', 'first\n', 'second\n'),
      ],
      [],
      new Map([['a.ts', { editCount: 1, baseline: 'first\n' }]])
    );

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      path: 'a.ts',
      baseline: 'first\n',
      current: 'second\n',
      editCount: 2,
    });
  });

  it('resurfaces an undone file even when the redo reproduces identical content', () => {
    // Undo at edit #1 reverts to "orig", then a redo lands the same "changed"
    // content as before: the edit count advances and the baseline is the
    // reverted-to content, so the file reappears for review.
    const files = deriveChangedFiles(
      [
        toolMessage('a.ts', 'orig\n', 'changed\n'),
        toolMessage('a.ts', 'orig\n', 'changed\n'),
      ],
      [],
      new Map([['a.ts', { editCount: 1, baseline: 'orig\n' }]])
    );

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      baseline: 'orig\n',
      current: 'changed\n',
      editCount: 2,
    });
  });

  it('diffs from the last resolved state, not the original baseline', () => {
    // a.ts: orig -> kept (kept at edit #1), then kept -> kept+plus. The panel
    // should show only the new line, treating "kept" as the baseline.
    const files = deriveChangedFiles(
      [
        toolMessage('a.ts', 'orig\n', 'kept\n'),
        toolMessage('a.ts', 'kept\n', 'kept\nplus\n'),
      ],
      [],
      new Map([['a.ts', { editCount: 1, baseline: 'kept\n' }]])
    );

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      baseline: 'kept\n',
      current: 'kept\nplus\n',
      added: 1,
      removed: 0,
    });
  });

  it('hides a file rewritten back to its last resolved state', () => {
    const files = deriveChangedFiles(
      [
        toolMessage('a.ts', 'orig\n', 'kept\n'),
        toolMessage('a.ts', 'kept\n', 'experiment\n'),
        toolMessage('a.ts', 'experiment\n', 'kept\n'),
      ],
      [],
      new Map([['a.ts', { editCount: 1, baseline: 'kept\n' }]])
    );

    expect(files).toEqual([]);
  });

  it('drops no-op edits that end up identical to the baseline', () => {
    const files = deriveChangedFiles(
      [
        toolMessage('a.ts', 'same\n', 'changed\n'),
        toolMessage('a.ts', 'changed\n', 'same\n'),
      ],
      [],
      new Map()
    );

    expect(files).toEqual([]);
  });

  it('marks a file emptied to nothing as deleted', () => {
    const files = deriveChangedFiles(
      [toolMessage('gone.ts', 'a\nb\n', '')],
      [],
      new Map()
    );

    expect(files[0]).toMatchObject({
      path: 'gone.ts',
      created: false,
      deleted: true,
      removed: 2,
    });
  });

  it('restores the content present right before deletion, not the original', () => {
    const files = deriveChangedFiles(
      [
        toolMessage('a.ts', 'orig\n', 'edited\n'),
        toolMessage('a.ts', 'edited\n', ''),
      ],
      [],
      new Map()
    );

    // "edited" is what existed right before the rm, so that's what Restore
    // should put back.
    expect(files[0]).toMatchObject({
      baseline: 'edited\n',
      current: '',
      deleted: true,
    });
  });

  it('shows a file created then deleted in the same session so it can be restored', () => {
    const files = deriveChangedFiles(
      [
        toolMessage('made.ts', '', 'fresh\n'),
        toolMessage('made.ts', 'fresh\n', ''),
      ],
      [],
      new Map()
    );

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      path: 'made.ts',
      baseline: 'fresh\n',
      current: '',
      deleted: true,
      created: false,
    });
  });

  it('summarizes totals across files', () => {
    const files = deriveChangedFiles(
      [
        toolMessage('a.ts', 'one\n', 'one\ntwo\n'),
        toolMessage('b.ts', 'x\ny\n', 'x\n'),
      ],
      [],
      new Map()
    );

    expect(summarizeChanges(files)).toEqual({ added: 1, removed: 1 });
  });
});
