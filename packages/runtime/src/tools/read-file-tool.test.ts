import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalWorkspaceFileService } from '@runtime/workspace/local-workspace-file-service';
import { ReadFileTool } from '@runtime/tools/read-file-tool';

describe('ReadFileTool', () => {
  let workspaceRoot: string;
  let maxLines: number;
  let tool: ReadFileTool;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'justcode-read-'));
    maxLines = 2000;
    tool = new ReadFileTool(
      new LocalWorkspaceFileService(workspaceRoot),
      () => maxLines
    );
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const seed = (path: string, content: string): Promise<void> =>
    writeFile(join(workspaceRoot, path), content, 'utf8');

  it('reads a whole small file with numbered lines', async () => {
    await seed('a.txt', 'one\ntwo\nthree');

    const result = await tool.execute(JSON.stringify({ path: 'a.txt' }), {
      workspaceRoot,
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toBe(
      'a.txt lines 1-3 of 3\n1 | one\n2 | two\n3 | three'
    );
    expect(result.content).not.toContain('truncated');
  });

  it('treats a trailing newline as not adding a phantom line', async () => {
    await seed('a.txt', 'one\ntwo\n');

    const result = await tool.execute(JSON.stringify({ path: 'a.txt' }), {
      workspaceRoot,
    });

    expect(result.content).toBe('a.txt lines 1-2 of 2\n1 | one\n2 | two');
  });

  it('handles CRLF line endings', async () => {
    await seed('crlf.txt', 'one\r\ntwo\r\nthree');

    const result = await tool.execute(JSON.stringify({ path: 'crlf.txt' }), {
      workspaceRoot,
    });

    expect(result.content).toBe(
      'crlf.txt lines 1-3 of 3\n1 | one\n2 | two\n3 | three'
    );
  });

  it('caps output at the configured line limit and reports the next offset', async () => {
    maxLines = 2;
    await seed('big.txt', 'a\nb\nc\nd');

    const result = await tool.execute(JSON.stringify({ path: 'big.txt' }), {
      workspaceRoot,
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('big.txt lines 1-2 of 4');
    expect(result.content).toContain('1 | a');
    expect(result.content).toContain('2 | b');
    expect(result.content).not.toContain('3 | c');
    expect(result.content).toContain('truncated: 2 more lines');
    expect(result.content).toContain('use offset=3 to continue');
  });

  it('continues from a 1-based line offset', async () => {
    await seed('lines.txt', 'aa\nbb\ncc\ndd');

    const result = await tool.execute(
      JSON.stringify({ path: 'lines.txt', offset: 3 }),
      { workspaceRoot }
    );

    expect(result.content).toBe('lines.txt lines 3-4 of 4\n3 | cc\n4 | dd');
  });

  it('honors a per-call limit (capped by the configured max)', async () => {
    maxLines = 100;
    await seed('lines.txt', 'a\nb\nc\nd\ne');

    const result = await tool.execute(
      JSON.stringify({ path: 'lines.txt', offset: 2, limit: 2 }),
      { workspaceRoot }
    );

    expect(result.content).toContain('lines.txt lines 2-3 of 5');
    expect(result.content).toContain('2 | b');
    expect(result.content).toContain('3 | c');
    expect(result.content).toContain('use offset=4 to continue');
  });

  it('truncates an extremely long line and flags it', async () => {
    const longLine = 'x'.repeat(9000);
    await seed('long.txt', longLine);

    const result = await tool.execute(JSON.stringify({ path: 'long.txt' }), {
      workspaceRoot,
    });

    expect(result.content).toContain('line truncated: 9000 chars total');
    expect(result.content).toContain('showing first 8192');
    // The full 9000-char line is not present.
    expect(result.content).not.toContain('x'.repeat(9000));
  });

  it('reports an empty file', async () => {
    await seed('empty.txt', '');

    const result = await tool.execute(JSON.stringify({ path: 'empty.txt' }), {
      workspaceRoot,
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('empty');
  });

  it('errors when the offset is past the end of the file', async () => {
    await seed('a.txt', 'one\ntwo');

    const result = await tool.execute(
      JSON.stringify({ path: 'a.txt', offset: 999 }),
      { workspaceRoot }
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain('past the end');
  });

  it('rejects paths that escape the workspace root', async () => {
    const result = await tool.execute(
      JSON.stringify({ path: '../escape.txt' }),
      { workspaceRoot }
    );

    expect(result.isError).toBe(true);
  });

  it('returns an error for unparseable arguments', async () => {
    const result = await tool.execute('not json', { workspaceRoot });

    expect(result.isError).toBe(true);
  });

  it('does not require approval', () => {
    expect(tool.requiresApproval).toBe(false);
  });
});
