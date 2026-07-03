import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalWorkspaceFileService } from '@runtime/workspace/local-workspace-file-service';
import { ApplyPatchTool } from '@runtime/tools/apply-patch-tool';

describe('ApplyPatchTool', () => {
  let workspaceRoot: string;
  let tool: ApplyPatchTool;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'justcode-patch-'));
    tool = new ApplyPatchTool(new LocalWorkspaceFileService(workspaceRoot));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  async function seed(path: string, content: string): Promise<void> {
    await writeFile(join(workspaceRoot, path), content, 'utf8');
  }

  function run(patch: string): Promise<{ content: string; isError?: boolean }> {
    return tool.execute(JSON.stringify({ patch }), { workspaceRoot });
  }

  it('applies a hunk that modifies an existing file', async () => {
    await seed('greeting.txt', 'hello\nworld\n');

    const patch = [
      '--- a/greeting.txt',
      '+++ b/greeting.txt',
      '@@ -1,2 +1,2 @@',
      ' hello',
      '-world',
      '+there',
      '',
    ].join('\n');

    const result = await run(patch);

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('updated greeting.txt');
    expect(await readFile(join(workspaceRoot, 'greeting.txt'), 'utf8')).toBe(
      'hello\nthere\n'
    );
  });

  it('creates a new file from a /dev/null section', async () => {
    const patch = [
      '--- /dev/null',
      '+++ b/new.txt',
      '@@ -0,0 +1,2 @@',
      '+first',
      '+second',
      '',
    ].join('\n');

    const result = await run(patch);

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('created new.txt');
    expect(await readFile(join(workspaceRoot, 'new.txt'), 'utf8')).toBe(
      'first\nsecond\n'
    );
  });

  it('applies a multi-file patch atomically', async () => {
    await seed('a.txt', 'a1\na2\n');
    await seed('b.txt', 'b1\nb2\n');

    const patch = [
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,2 +1,2 @@',
      ' a1',
      '-a2',
      '+a2-changed',
      '--- a/b.txt',
      '+++ b/b.txt',
      '@@ -1,2 +1,2 @@',
      ' b1',
      '-b2',
      '+b2-changed',
      '',
    ].join('\n');

    const result = await run(patch);

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('2 files');
    expect(await readFile(join(workspaceRoot, 'a.txt'), 'utf8')).toBe(
      'a1\na2-changed\n'
    );
    expect(await readFile(join(workspaceRoot, 'b.txt'), 'utf8')).toBe(
      'b1\nb2-changed\n'
    );
  });

  it('writes nothing when one section in a multi-file patch fails', async () => {
    await seed('a.txt', 'a1\na2\n');
    await seed('b.txt', 'b1\nb2\n');

    const patch = [
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,2 +1,2 @@',
      ' a1',
      '-a2',
      '+a2-changed',
      '--- a/b.txt',
      '+++ b/b.txt',
      '@@ -1,2 +1,2 @@',
      ' b1',
      '-does-not-match',
      '+b2-changed',
      '',
    ].join('\n');

    const result = await run(patch);

    expect(result.isError).toBe(true);
    expect(result.content).toContain('did not apply to b.txt');
    // The first section must not have been committed.
    expect(await readFile(join(workspaceRoot, 'a.txt'), 'utf8')).toBe(
      'a1\na2\n'
    );
  });

  it('errors when a hunk context does not match', async () => {
    await seed('a.txt', 'completely different\n');

    const patch = [
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,1 +1,1 @@',
      '-hello',
      '+world',
      '',
    ].join('\n');

    const result = await run(patch);

    expect(result.isError).toBe(true);
    expect(result.content).toContain('did not apply');
  });

  it('refuses to delete a file', async () => {
    await seed('gone.txt', 'bye\n');

    const patch = [
      '--- a/gone.txt',
      '+++ /dev/null',
      '@@ -1,1 +0,0 @@',
      '-bye',
      '',
    ].join('\n');

    const result = await run(patch);

    expect(result.isError).toBe(true);
    expect(result.content).toContain('does not support file deletion');
    // File is untouched.
    expect(await readFile(join(workspaceRoot, 'gone.txt'), 'utf8')).toBe(
      'bye\n'
    );
  });

  it('rejects unparseable arguments', async () => {
    const result = await tool.execute('not json', { workspaceRoot });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid arguments');
  });

  it('previewDiff reports the before/after of the first changed file', async () => {
    await seed('greeting.txt', 'hello\nworld\n');

    const patch = [
      '--- a/greeting.txt',
      '+++ b/greeting.txt',
      '@@ -1,2 +1,2 @@',
      ' hello',
      '-world',
      '+there',
      '',
    ].join('\n');

    const diff = await tool.previewDiff(JSON.stringify({ patch }), {
      workspaceRoot,
    });

    expect(diff).toEqual({
      path: 'greeting.txt',
      oldText: 'hello\nworld\n',
      newText: 'hello\nthere\n',
    });
  });

  it('applies bare-@@ hunks (no line numbers) by context matching', async () => {
    await seed(
      'service.ts',
      [
        'class Service {',
        '  async first() {',
        '    return 1;',
        '  }',
        '',
        '  async second() {',
        '    return 2;',
        '  }',
        '}',
        '',
      ].join('\n')
    );

    // The dialect OpenAI-trained models emit: bare `@@` separators, a
    // context-only locator chunk, and a `*** End Patch` trailer.
    const patch = [
      '--- a/service.ts',
      '+++ b/service.ts',
      '@@',
      '   async first() {',
      '@@',
      '     return 2;',
      '   }',
      '+',
      '+  async third() {',
      '+    return 3;',
      '+  }',
      '*** End Patch',
      '',
    ].join('\n');

    const result = await run(patch);

    expect(result.isError).toBeFalsy();
    expect(await readFile(join(workspaceRoot, 'service.ts'), 'utf8')).toBe(
      [
        'class Service {',
        '  async first() {',
        '    return 1;',
        '  }',
        '',
        '  async second() {',
        '    return 2;',
        '  }',
        '',
        '  async third() {',
        '    return 3;',
        '  }',
        '}',
        '',
      ].join('\n')
    );
  });

  it('applies an @@ marker hunk scoped by its locator text', async () => {
    await seed(
      'pair.ts',
      [
        'function a() {',
        '  return 0;',
        '}',
        'function b() {',
        '  return 0;',
        '}',
        '',
      ].join('\n')
    );

    const patch = [
      '--- a/pair.ts',
      '+++ b/pair.ts',
      '@@ function b() {',
      '-  return 0;',
      '+  return 1;',
      '',
    ].join('\n');

    const result = await run(patch);

    expect(result.isError).toBeFalsy();
    expect(await readFile(join(workspaceRoot, 'pair.ts'), 'utf8')).toBe(
      [
        'function a() {',
        '  return 0;',
        '}',
        'function b() {',
        '  return 1;',
        '}',
        '',
      ].join('\n')
    );
  });

  it('supports the *** Update/Add File header dialect', async () => {
    await seed('old.txt', 'keep\ndrop\n');

    const patch = [
      '*** Begin Patch',
      '*** Update File: old.txt',
      '@@',
      ' keep',
      '-drop',
      '+kept',
      '*** Add File: fresh.txt',
      '@@',
      '+brand new',
      '*** End Patch',
      '',
    ].join('\n');

    const result = await run(patch);

    expect(result.isError).toBeFalsy();
    expect(await readFile(join(workspaceRoot, 'old.txt'), 'utf8')).toBe(
      'keep\nkept\n'
    );
    expect(await readFile(join(workspaceRoot, 'fresh.txt'), 'utf8')).toBe(
      'brand new\n'
    );
  });

  it('errors when a bare-@@ hunk context does not match', async () => {
    await seed('x.txt', 'alpha\nbeta\n');

    const patch = [
      '--- a/x.txt',
      '+++ b/x.txt',
      '@@',
      ' gamma',
      '+delta',
      '',
    ].join('\n');

    const result = await run(patch);

    expect(result.isError).toBe(true);
    expect(result.content).toContain('did not apply');
    expect(await readFile(join(workspaceRoot, 'x.txt'), 'utf8')).toBe(
      'alpha\nbeta\n'
    );
  });
});
