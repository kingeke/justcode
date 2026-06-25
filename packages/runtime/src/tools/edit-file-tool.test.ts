import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalWorkspaceFileService } from '@runtime/workspace/local-workspace-file-service';
import { EditFileTool } from '@runtime/tools/edit-file-tool';

describe('EditFileTool', () => {
  let workspaceRoot: string;
  let tool: EditFileTool;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'justcode-edit-'));
    tool = new EditFileTool(new LocalWorkspaceFileService(workspaceRoot));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  async function seed(path: string, content: string): Promise<void> {
    await writeFile(join(workspaceRoot, path), content, 'utf8');
  }

  it('replaces a unique occurrence and reports the count', async () => {
    await seed('greeting.txt', 'hello world');

    const result = await tool.execute(
      JSON.stringify({
        path: 'greeting.txt',
        old_string: 'world',
        new_string: 'there',
      }),
      { workspaceRoot }
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('1 occurrence replaced');
    expect(await readFile(join(workspaceRoot, 'greeting.txt'), 'utf8')).toBe(
      'hello there'
    );
  });

  it('errors when old_string is not found', async () => {
    await seed('a.txt', 'hello');

    const result = await tool.execute(
      JSON.stringify({ path: 'a.txt', old_string: 'nope', new_string: 'x' }),
      { workspaceRoot }
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain('No match');
  });

  it('errors on an ambiguous match unless replace_all is set', async () => {
    await seed('a.txt', 'x x x');

    const ambiguous = await tool.execute(
      JSON.stringify({ path: 'a.txt', old_string: 'x', new_string: 'y' }),
      { workspaceRoot }
    );
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.content).toContain('appears 3 times');
    // The error enumerates each match with its line number to guide a retry.
    expect(ambiguous.content).toContain('line 1');

    const all = await tool.execute(
      JSON.stringify({
        path: 'a.txt',
        old_string: 'x',
        new_string: 'y',
        replace_all: true,
      }),
      { workspaceRoot }
    );
    expect(all.isError).toBeFalsy();
    expect(all.content).toContain('3 occurrences replaced');
    expect(await readFile(join(workspaceRoot, 'a.txt'), 'utf8')).toBe('y y y');
  });

  it('scopes a repeated string to a line window to make it unique', async () => {
    // Mirrors the index.html case: the same <p> repeats in three divs.
    await seed(
      'index.html',
      [
        '<div>',
        '  <h1>One</h1>',
        '  <p>This is a serious file</p>',
        '</div>',
        '<div>',
        '  <h1>Two</h1>',
        '  <p>This is a serious file</p>',
        '</div>',
        '<div>',
        '  <h1>Three</h1>',
        '  <p>This is a serious file</p>',
        '</div>',
        '',
      ].join('\n')
    );

    const result = await tool.execute(
      JSON.stringify({
        path: 'index.html',
        old_string: 'This is a serious file',
        new_string: 'This is a not serious file',
        start_line: 9,
        end_line: 12,
      }),
      { workspaceRoot }
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('1 occurrence replaced');

    const after = await readFile(join(workspaceRoot, 'index.html'), 'utf8');
    // Only the third div changed; the first two are untouched.
    expect(after).toContain(
      '<h1>Three</h1>\n  <p>This is a not serious file</p>'
    );
    expect(after.match(/This is a serious file/g)?.length).toBe(2);
  });

  it('errors when old_string is absent from the given line window', async () => {
    await seed('a.txt', 'alpha\nbeta\ngamma\n');

    const result = await tool.execute(
      JSON.stringify({
        path: 'a.txt',
        old_string: 'gamma',
        new_string: 'delta',
        start_line: 1,
        end_line: 2,
      }),
      { workspaceRoot }
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain('within lines 1-2');
  });

  it('rejects an inverted line window', async () => {
    await seed('a.txt', 'alpha\nbeta\n');

    const result = await tool.execute(
      JSON.stringify({
        path: 'a.txt',
        old_string: 'beta',
        new_string: 'b',
        start_line: 5,
        end_line: 1,
      }),
      { workspaceRoot }
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain('start_line 5 is after end_line 1');
  });

  it('rejects an empty old_string', async () => {
    await seed('a.txt', 'hello');

    const result = await tool.execute(
      JSON.stringify({ path: 'a.txt', old_string: '', new_string: 'x' }),
      { workspaceRoot }
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain('must not be empty');
  });

  it('rejects identical old and new strings', async () => {
    await seed('a.txt', 'hello');

    const result = await tool.execute(
      JSON.stringify({
        path: 'a.txt',
        old_string: 'hello',
        new_string: 'hello',
      }),
      { workspaceRoot }
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain('identical');
  });

  it('rejects paths that escape the workspace root', async () => {
    const result = await tool.execute(
      JSON.stringify({
        path: '../escape.txt',
        old_string: 'a',
        new_string: 'b',
      }),
      { workspaceRoot }
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain('outside the workspace');
  });

  it('returns an error for unparseable arguments', async () => {
    const result = await tool.execute('not json', { workspaceRoot });

    expect(result.isError).toBe(true);
  });

  it('previewDiff returns before/after for a valid edit', async () => {
    await seed('a.txt', 'hello world');

    const diff = await tool.previewDiff(
      JSON.stringify({
        path: 'a.txt',
        old_string: 'world',
        new_string: 'there',
      }),
      { workspaceRoot }
    );

    expect(diff).toEqual({
      path: 'a.txt',
      oldText: 'hello world',
      newText: 'hello there',
    });
  });

  it('previewDiff returns undefined when the edit would not apply', async () => {
    await seed('a.txt', 'x x x');

    // Ambiguous match → no diff to preview.
    const ambiguous = await tool.previewDiff(
      JSON.stringify({ path: 'a.txt', old_string: 'x', new_string: 'y' }),
      { workspaceRoot }
    );
    expect(ambiguous).toBeUndefined();

    // No match → undefined.
    const missing = await tool.previewDiff(
      JSON.stringify({ path: 'a.txt', old_string: 'z', new_string: 'y' }),
      { workspaceRoot }
    );
    expect(missing).toBeUndefined();
  });

  it('describes a call with the path as title and a diff-like preview', () => {
    const view = tool.describe(
      JSON.stringify({ path: 'a.txt', old_string: 'foo', new_string: 'bar' })
    );

    expect(view.title).toBe('edit a.txt');
    expect(view.preview).toContain('foo');
    expect(view.preview).toContain('bar');
  });
});
