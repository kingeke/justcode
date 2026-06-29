import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

import ignore, { type Ignore } from 'ignore';

import type { WorkspaceFilePort } from '@core/ports/workspace-file-port';

// Always skipped, regardless of .gitignore: `.git` is never useful to surface,
// and these are the conventional heavyweights that are almost always ignored
// anyway. Kept as a backstop so listings stay clean even in a project with no
// .gitignore (or one that omits them).
const ALWAYS_IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
]);

export class LocalWorkspaceFileService implements WorkspaceFilePort {
  public constructor(private readonly workspaceRoot: string) {}

  public async listFiles(): Promise<string[]> {
    const files = await this.walkDirectory(this.workspaceRoot, []);
    return files.sort((left, right) => left.localeCompare(right));
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

  /**
   * Walks the workspace, honoring `.gitignore` the way git does: rules apply to
   * the directory they live in and everything below it, so we accumulate a
   * matcher per directory and carry the stack down. `filters` is the list of
   * matchers in scope (root-most first); each one tests paths relative to its
   * own base directory. Ignored files and directories are pruned so search and
   * `@`-mention listings don't waste context on build output, logs, env files,
   * and the like.
   */
  private async walkDirectory(
    directoryPath: string,
    filters: GitignoreFilter[]
  ): Promise<string[]> {
    const scopedFilters = await this.withLocalGitignore(directoryPath, filters);
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const absolutePath = resolve(directoryPath, entry.name);
      const relativePath = this.toWorkspaceRelative(absolutePath);

      if (entry.isDirectory()) {
        if (ALWAYS_IGNORED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        // Gitignore directory patterns match the path with a trailing slash, so
        // test the directory form before descending into it.
        if (isIgnored(`${relativePath}/`, scopedFilters)) {
          continue;
        }

        const nestedFiles = await this.walkDirectory(
          absolutePath,
          scopedFilters
        );
        files.push(...nestedFiles);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (isIgnored(relativePath, scopedFilters)) {
        continue;
      }

      files.push(relativePath);
    }

    return files;
  }

  /**
   * Returns `filters` plus a matcher for this directory's `.gitignore`, if one
   * exists. A directory with no `.gitignore` (the common case) reuses the
   * inherited stack unchanged so we don't allocate on every level.
   */
  private async withLocalGitignore(
    directoryPath: string,
    filters: GitignoreFilter[]
  ): Promise<GitignoreFilter[]> {
    let contents: string;
    try {
      contents = await readFile(resolve(directoryPath, '.gitignore'), 'utf8');
    } catch {
      return filters;
    }

    const base = this.toWorkspaceRelative(directoryPath);
    return [...filters, { base, matcher: ignore().add(contents) }];
  }

  private toWorkspaceRelative(absolutePath: string): string {
    return relative(this.workspaceRoot, absolutePath).split(sep).join('/');
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

/** A `.gitignore` matcher plus the workspace-relative directory it applies to. */
interface GitignoreFilter {
  /** Directory the rules are anchored to (''= workspace root). */
  base: string;
  matcher: Ignore;
}

/**
 * Tests a workspace-relative path against every applicable matcher. Each
 * matcher only sees the path relative to its own base, matching git's rule that
 * a nested `.gitignore` governs its own subtree. An empty relative path (the
 * base dir itself) is never ignored.
 */
function isIgnored(
  workspaceRelativePath: string,
  filters: GitignoreFilter[]
): boolean {
  return filters.some(({ base, matcher }) => {
    const relativeToBase =
      base.length === 0
        ? workspaceRelativePath
        : workspaceRelativePath.slice(base.length + 1);
    if (relativeToBase.length === 0 || relativeToBase === '/') {
      return false;
    }
    return matcher.ignores(relativeToBase);
  });
}
