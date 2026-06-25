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
      JSON.stringify({ path: 'a.txt', old_string: 'hello', new_string: 'hello' }),
      { workspaceRoot }
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain('identical');
  });

  it('rejects paths that escape the workspace root', async () => {
    const result = await tool.execute(
      JSON.stringify({ path: '../escape.txt', old_string: 'a', new_string: 'b' }),
      { workspaceRoot }
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain('outside the workspace');
  });

  it('returns an error for unparseable arguments', async () => {
    const result = await tool.execute('not json', { workspaceRoot });

    expect(result.isError).toBe(true);
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
