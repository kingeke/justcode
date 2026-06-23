import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalWorkspaceFileService } from '@runtime/workspace/local-workspace-file-service';
import { ReadFileTool } from '@runtime/tools/read-file-tool';

describe('ReadFileTool', () => {
  let workspaceRoot: string;
  let maxBytes: number;
  let tool: ReadFileTool;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'justcode-read-'));
    maxBytes = 1024;
    tool = new ReadFileTool(
      new LocalWorkspaceFileService(workspaceRoot),
      () => maxBytes
    );
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const seed = (path: string, content: string): Promise<void> =>
    writeFile(join(workspaceRoot, path), content, 'utf8');

  it('reads a whole small file with line numbers', async () => {
    await seed('a.txt', 'one\ntwo\nthree');

    const result = await tool.execute(JSON.stringify({ path: 'a.txt' }), {
      workspaceRoot,
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toBe('1\tone\n2\ttwo\n3\tthree');
    expect(result.content).not.toContain('Use offset=');
  });

  it('caps output at the configured size and reports the next offset', async () => {
    maxBytes = 10;
    await seed('big.txt', 'abcdefghijKLMNOP');

    const result = await tool.execute(JSON.stringify({ path: 'big.txt' }), {
      workspaceRoot,
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('1\tabcdefghij');
    expect(result.content).toContain('Showing bytes 0-10 of 16');
    expect(result.content).toContain('Use offset=10 to continue');
  });

  it('continues from a byte offset with correct line numbers', async () => {
    maxBytes = 4;
    await seed('lines.txt', 'aa\nbb\ncc\ndd');

    const result = await tool.execute(
      JSON.stringify({ path: 'lines.txt', offset: 6 }),
      { workspaceRoot }
    );

    // Bytes 6-10 are "cc\ndd"; line 3 starts at byte 6.
    expect(result.content).toContain('3\tcc');
    expect(result.content).toContain('4\td');
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
    await seed('a.txt', 'short');

    const result = await tool.execute(
      JSON.stringify({ path: 'a.txt', offset: 999 }),
      { workspaceRoot }
    );

    expect(result.isError).toBe(true);
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
