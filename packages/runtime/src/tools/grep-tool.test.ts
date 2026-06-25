import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalWorkspaceFileService } from '@runtime/workspace/local-workspace-file-service';
import { GrepTool } from '@runtime/tools/grep-tool';

describe('GrepTool', () => {
  let workspaceRoot: string;
  let tool: GrepTool;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'justcode-grep-'));
    tool = new GrepTool(new LocalWorkspaceFileService(workspaceRoot));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const seed = async (path: string, content: string): Promise<void> => {
    const absolute = join(workspaceRoot, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content, 'utf8');
  };

  const run = (args: Record<string, unknown>) =>
    tool.execute(JSON.stringify(args), { workspaceRoot });

  it('finds literal matches across files', async () => {
    await seed('a.txt', 'alpha\nneedle here\nomega');
    await seed('nested/b.txt', 'first\nneedle again');

    const result = await run({ pattern: 'needle', literal: true });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Found 2 matching lines in 2 files.');
    expect(result.content).toContain('a.txt:2: needle here');
    expect(result.content).toContain('nested/b.txt:2: needle again');
  });

  it('supports regular expressions and path prefixes', async () => {
    await seed('src/a.ts', 'foo\nbar');
    await seed('src/nested/b.ts', 'baz\nfood');
    await seed('docs/readme.md', 'foo');

    const result = await run({ pattern: '^foo', path: 'src' });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Found 2 matching lines in 2 files.');
    expect(result.content).toContain('src/a.ts:1: foo');
    expect(result.content).toContain('src/nested/b.ts:2: food');
    expect(result.content).not.toContain('docs/readme.md');
  });

  it('reports no matches cleanly', async () => {
    await seed('a.txt', 'alpha\nbeta');

    const result = await run({ pattern: 'needle', literal: true });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('No matches found');
  });

  it('rejects invalid regular expressions', async () => {
    const result = await run({ pattern: '[' });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid pattern');
  });

  it('returns an error for unparseable arguments', async () => {
    const result = await tool.execute('not json', { workspaceRoot });

    expect(result.isError).toBe(true);
  });

  it('does not require approval', () => {
    expect(tool.requiresApproval).toBe(false);
  });
});
