import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalWorkspaceFileService } from '@runtime/workspace/local-workspace-file-service';
import { WriteFileTool } from '@runtime/tools/write-file-tool';

describe('WriteFileTool', () => {
  let workspaceRoot: string;
  let tool: WriteFileTool;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'justcode-write-'));
    tool = new WriteFileTool(new LocalWorkspaceFileService(workspaceRoot));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it('writes a file (creating parent dirs) and reports the line count', async () => {
    const result = await tool.execute(
      JSON.stringify({ path: 'src/greeting.txt', content: 'a\nb\nc' }),
      { workspaceRoot }
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('3 lines');
    expect(
      await readFile(join(workspaceRoot, 'src/greeting.txt'), 'utf8')
    ).toBe('a\nb\nc');
  });

  it('rejects paths that escape the workspace root', async () => {
    const result = await tool.execute(
      JSON.stringify({ path: '../escape.txt', content: 'x' }),
      { workspaceRoot }
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain('outside the workspace');
  });

  it('returns an error for unparseable arguments', async () => {
    const result = await tool.execute('not json', { workspaceRoot });

    expect(result.isError).toBe(true);
  });

  it('previewDiff diffs against the existing file and is empty for creates', async () => {
    // Creating a new file: oldText is empty (renders as all additions).
    const created = await tool.previewDiff(
      JSON.stringify({ path: 'new.txt', content: 'fresh' }),
      { workspaceRoot }
    );
    expect(created).toEqual({ path: 'new.txt', oldText: '', newText: 'fresh' });

    // Overwriting: oldText is the prior content.
    await tool.execute(JSON.stringify({ path: 'new.txt', content: 'fresh' }), {
      workspaceRoot,
    });
    const overwrite = await tool.previewDiff(
      JSON.stringify({ path: 'new.txt', content: 'updated' }),
      { workspaceRoot }
    );
    expect(overwrite).toEqual({
      path: 'new.txt',
      oldText: 'fresh',
      newText: 'updated',
    });
  });

  it('previewDiff returns undefined when content is unchanged', async () => {
    await tool.execute(
      JSON.stringify({ path: 'same.txt', content: 'identical' }),
      { workspaceRoot }
    );
    const diff = await tool.previewDiff(
      JSON.stringify({ path: 'same.txt', content: 'identical' }),
      { workspaceRoot }
    );
    expect(diff).toBeUndefined();
  });

  it('describes a call with the path as title and content as preview', () => {
    const view = tool.describe(
      JSON.stringify({ path: 'a.txt', content: 'hello' })
    );

    expect(view.title).toBe('write a.txt');
    expect(view.preview).toBe('hello');
  });
});
