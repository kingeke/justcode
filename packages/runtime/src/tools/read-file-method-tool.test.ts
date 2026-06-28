import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalWorkspaceFileService } from '@runtime/workspace/local-workspace-file-service';
import { ReadFileMethodTool } from '@runtime/tools/read-file-method-tool';

describe('ReadFileMethodTool', () => {
  let workspaceRoot: string;
  let maxLines: number;
  let tool: ReadFileMethodTool;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'justcode-read-method-'));
    maxLines = 2000;
    tool = new ReadFileMethodTool(
      new LocalWorkspaceFileService(workspaceRoot),
      () => maxLines
    );
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const seed = (path: string, content: string): Promise<void> =>
    writeFile(join(workspaceRoot, path), content, 'utf8');

  const file = [
    'export class Repo {',
    '  async findOne(id) {',
    '    return id;',
    '  }',
    '',
    '  async findMany(ids) {',
    '    const rows = await db.many(ids);',
    '    return rows;',
    '  }',
    '}',
  ].join('\n');

  it('reads just the named method with real file line numbers', async () => {
    await seed('repo.ts', file);

    const result = await tool.execute(
      JSON.stringify({ path: 'repo.ts', method: 'findMany' }),
      { workspaceRoot }
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toBe(
      [
        'repo.ts::findMany lines 6-9 of 6-9',
        '6 |   async findMany(ids) {',
        '7 |     const rows = await db.many(ids);',
        '8 |     return rows;',
        '9 |   }',
      ].join('\n')
    );
  });

  it('pages within a method via offset and limit', async () => {
    await seed('repo.ts', file);

    const result = await tool.execute(
      JSON.stringify({ path: 'repo.ts', method: 'findMany', offset: 2, limit: 1 }),
      { workspaceRoot }
    );

    expect(result.content).toContain('repo.ts::findMany lines 7-7 of 6-9');
    expect(result.content).toContain('7 |     const rows = await db.many(ids);');
    expect(result.content).toContain('use offset=3 to continue');
  });

  it('lists available symbols when the method is not found', async () => {
    await seed('repo.ts', file);

    const result = await tool.execute(
      JSON.stringify({ path: 'repo.ts', method: 'missing' }),
      { workspaceRoot }
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Method 'missing' was not found");
    expect(result.content).toContain('Repo');
    expect(result.content).toContain('findOne');
    expect(result.content).toContain('findMany');
  });

  it('errors when the file cannot be read', async () => {
    const result = await tool.execute(
      JSON.stringify({ path: 'nope.ts', method: 'x' }),
      { workspaceRoot }
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain('Failed to read nope.ts');
  });

  it('rejects arguments missing the method name', async () => {
    const result = await tool.execute(JSON.stringify({ path: 'repo.ts' }), {
      workspaceRoot,
    });

    expect(result.isError).toBe(true);
  });
});
