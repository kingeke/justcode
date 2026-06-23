import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

import type { WorkspaceFilePort } from '@core/ports/workspace-file-port';

const IGNORED_DIRECTORIES = new Set([
  '.git',
  'coverage',
  'dist',
  'node_modules',
]);

export class LocalWorkspaceFileService implements WorkspaceFilePort {
  public constructor(private readonly workspaceRoot: string) {}

  public async listFiles(): Promise<string[]> {
    return this.walkDirectory(this.workspaceRoot);
  }

  public async readFile(relativePath: string): Promise<string> {
    const absolutePath = this.resolveWorkspacePath(relativePath);
    return readFile(absolutePath, 'utf8');
  }

  public async readFileBytes(relativePath: string): Promise<Uint8Array> {
    const absolutePath = this.resolveWorkspacePath(relativePath);
    return readFile(absolutePath);
  }

  public async writeFile(relativePath: string, content: string): Promise<void> {
    const absolutePath = this.resolveWorkspacePath(relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, 'utf8');
  }

  private async walkDirectory(directoryPath: string): Promise<string[]> {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) {
          continue;
        }

        const nestedFiles = await this.walkDirectory(
          resolve(directoryPath, entry.name)
        );
        files.push(...nestedFiles);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const absolutePath = resolve(directoryPath, entry.name);
      const relativePath = relative(this.workspaceRoot, absolutePath)
        .split(sep)
        .join('/');
      files.push(relativePath);
    }

    return files.sort((left, right) => left.localeCompare(right));
  }

  private resolveWorkspacePath(relativePath: string): string {
    const absolutePath = resolve(this.workspaceRoot, relativePath);
    const pathFromRoot = relative(this.workspaceRoot, absolutePath);

    if (
      pathFromRoot.startsWith('..') ||
      pathFromRoot.includes(`${sep}..${sep}`)
    ) {
      throw new Error(`File '${relativePath}' is outside the workspace.`);
    }

    return absolutePath;
  }
}
