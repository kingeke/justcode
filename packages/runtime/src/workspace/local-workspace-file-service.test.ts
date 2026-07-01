import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalWorkspaceFileService } from '@runtime/workspace/local-workspace-file-service';

describe('LocalWorkspaceFileService.listFiles', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'justcode-ws-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function write(relativePath: string, content = ''): Promise<void> {
    const absolute = join(root, relativePath);
    await mkdir(join(absolute, '..'), { recursive: true });
    await writeFile(absolute, content, 'utf8');
  }

  it('omits files matched by the root .gitignore', async () => {
    await write('.gitignore', 'build/\n*.log\n.env\n');
    await write('src/index.ts');
    await write('build/output.js');
    await write('app.log');
    await write('.env', 'SECRET=1');

    const files = await new LocalWorkspaceFileService(root).listFiles();

    expect(files).toContain('src/index.ts');
    expect(files).toContain('.gitignore');
    expect(files).not.toContain('build/output.js');
    expect(files).not.toContain('app.log');
    expect(files).not.toContain('.env');
  });

  it('always skips .git and node_modules even without a .gitignore', async () => {
    await write('src/index.ts');
    await write('node_modules/pkg/index.js');
    await write('.git/HEAD', 'ref: refs/heads/main');

    const files = await new LocalWorkspaceFileService(root).listFiles();

    expect(files).toEqual(['src/index.ts']);
  });

  it('applies a nested .gitignore only within its own subtree', async () => {
    await write('packages/a/.gitignore', 'secret.txt\n');
    await write('packages/a/secret.txt');
    await write('packages/a/keep.ts');
    // Same filename outside the nested gitignore's scope must survive.
    await write('packages/b/secret.txt');

    const files = await new LocalWorkspaceFileService(root).listFiles();

    expect(files).not.toContain('packages/a/secret.txt');
    expect(files).toContain('packages/a/keep.ts');
    expect(files).toContain('packages/b/secret.txt');
  });

  it('honors negated re-includes from .gitignore', async () => {
    await write('.gitignore', '*.log\n!keep.log\n');
    await write('drop.log');
    await write('keep.log');

    const files = await new LocalWorkspaceFileService(root).listFiles();

    expect(files).not.toContain('drop.log');
    expect(files).toContain('keep.log');
  });
});

describe('LocalWorkspaceFileService path containment', () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'justcode-ws-'));
    outside = await mkdtemp(join(tmpdir(), 'justcode-outside-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('rejects `..` traversal and absolute paths outside the root', async () => {
    const service = new LocalWorkspaceFileService(root);

    await expect(service.readFile('../escape.txt')).rejects.toThrow(
      /outside the workspace/
    );
    await expect(service.readFile(join(outside, 'escape.txt'))).rejects.toThrow(
      /outside the workspace/
    );
  });

  it('refuses to READ through a symlink that points outside the root', async () => {
    // A secret living outside the workspace, reachable only via an in-workspace
    // symlink — the lexical guard alone would let this through.
    await writeFile(join(outside, 'secret.txt'), 'TOP SECRET', 'utf8');
    await symlink(outside, join(root, 'link'));

    const service = new LocalWorkspaceFileService(root);

    await expect(service.readFile('link/secret.txt')).rejects.toThrow(
      /outside the workspace/
    );
  });

  it('refuses to WRITE through a symlinked directory that escapes the root', async () => {
    await symlink(outside, join(root, 'link'));

    const service = new LocalWorkspaceFileService(root);

    await expect(
      service.writeFile('link/planted.txt', 'malicious')
    ).rejects.toThrow(/outside the workspace/);
  });

  it('still allows genuine in-workspace reads and writes', async () => {
    const service = new LocalWorkspaceFileService(root);

    await service.writeFile('nested/note.txt', 'hello');
    expect(await service.readFile('nested/note.txt')).toBe('hello');
    // And a symlink that stays inside the workspace is fine.
    await writeFile(join(root, 'real.txt'), 'inside', 'utf8');
    await symlink(join(root, 'real.txt'), join(root, 'alias.txt'));
    expect(await service.readFile('alias.txt')).toBe('inside');
  });
});

describe('LocalWorkspaceFileService read size limit', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'justcode-ws-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('refuses to read a file larger than the limit', async () => {
    // One byte over the 20 MB cap.
    const huge = Buffer.alloc(20 * 1024 * 1024 + 1, 0x61);
    await writeFile(join(root, 'huge.txt'), huge);

    const service = new LocalWorkspaceFileService(root);

    await expect(service.readFile('huge.txt')).rejects.toThrow(
      /exceeds the .* read limit/
    );
    await expect(service.readFileBytes('huge.txt')).rejects.toThrow(
      /exceeds the .* read limit/
    );
  });
});
