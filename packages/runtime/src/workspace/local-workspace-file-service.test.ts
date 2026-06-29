import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
