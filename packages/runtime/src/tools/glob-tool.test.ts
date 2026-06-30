import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalWorkspaceFileService } from '@runtime/workspace/local-workspace-file-service';
import { GlobTool } from '@runtime/tools/glob-tool';

describe('GlobTool', () => {
  let workspaceRoot: string;
  let tool: GlobTool;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'justcode-glob-'));
    tool = new GlobTool(new LocalWorkspaceFileService(workspaceRoot));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const seed = async (path: string, content = ''): Promise<void> => {
    const absolute = join(workspaceRoot, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content, 'utf8');
  };

  const run = (args: Record<string, unknown>) =>
    tool.execute(JSON.stringify(args), { workspaceRoot });

  it('matches files with a single-star pattern in one directory', async () => {
    await seed('src/a.ts');
    await seed('src/b.ts');
    await seed('src/nested/c.ts');

    const result = await run({ pattern: 'src/*.ts' });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Found 2 files.');
    expect(result.content).toContain('src/a.ts');
    expect(result.content).toContain('src/b.ts');
    expect(result.content).not.toContain('src/nested/c.ts');
  });

  it('matches across directories with a double-star pattern', async () => {
    await seed('src/a.ts');
    await seed('src/nested/deep/c.ts');
    await seed('docs/readme.md');

    const result = await run({ pattern: '**/*.ts' });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Found 2 files.');
    expect(result.content).toContain('src/a.ts');
    expect(result.content).toContain('src/nested/deep/c.ts');
    expect(result.content).not.toContain('docs/readme.md');
  });

  it('supports brace alternatives', async () => {
    await seed('a.ts');
    await seed('b.js');
    await seed('c.md');

    const result = await run({ pattern: '*.{ts,js}' });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Found 2 files.');
    expect(result.content).toContain('a.ts');
    expect(result.content).toContain('b.js');
    expect(result.content).not.toContain('c.md');
  });

  it('restricts matching with a path prefix', async () => {
    await seed('src/a.ts');
    await seed('src/nested/b.ts');
    await seed('lib/c.ts');

    const result = await run({ pattern: '**/*.ts', path: 'src' });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Found 2 files.');
    expect(result.content).toContain('src/a.ts');
    expect(result.content).toContain('src/nested/b.ts');
    expect(result.content).not.toContain('lib/c.ts');
  });

  it('matches a single character with a question mark', async () => {
    await seed('a1.ts');
    await seed('a12.ts');

    const result = await run({ pattern: 'a?.ts' });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Found 1 file.');
    expect(result.content).toContain('a1.ts');
    expect(result.content).not.toContain('a12.ts');
  });

  it('reports no matches cleanly', async () => {
    await seed('a.ts');

    const result = await run({ pattern: '*.md' });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('No files matched');
  });

  it('returns an error for unparseable arguments', async () => {
    const result = await tool.execute('not json', { workspaceRoot });

    expect(result.isError).toBe(true);
  });

  it('requires a non-empty pattern', async () => {
    const result = await run({ pattern: '   ' });

    expect(result.isError).toBe(true);
  });

  it('requires approval', () => {
    expect(tool.requiresApproval).toBe(true);
  });
});
