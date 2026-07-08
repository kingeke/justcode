import { describe, expect, it } from 'vitest';

import { rewriteDroppedPaths } from '@cli/ui/dropped-paths.js';

const WORKSPACE = '/home/user/project';

function existsAmong(...paths: string[]): (path: string) => boolean {
  const set = new Set(paths);
  return (path) => set.has(path);
}

describe('rewriteDroppedPaths', () => {
  it('rewrites a dropped workspace file into an @mention', () => {
    const result = rewriteDroppedPaths(
      '/home/user/project/src/index.html',
      WORKSPACE,
      existsAmong('/home/user/project/src/index.html')
    );

    expect(result).toBe('@src/index.html ');
  });

  it('keeps a dropped file outside the workspace as a plain absolute path', () => {
    const result = rewriteDroppedPaths(
      '/home/user/Downloads/report.csv',
      WORKSPACE,
      existsAmong('/home/user/Downloads/report.csv')
    );

    expect(result).toBe('/home/user/Downloads/report.csv ');
  });

  it('handles multiple dropped files at once', () => {
    const result = rewriteDroppedPaths(
      '/home/user/project/a.ts /home/user/other/b.ts',
      WORKSPACE,
      existsAmong('/home/user/project/a.ts', '/home/user/other/b.ts')
    );

    expect(result).toBe('@a.ts /home/user/other/b.ts ');
  });

  it('unescapes backslash-escaped spaces (macOS Terminal style)', () => {
    const result = rewriteDroppedPaths(
      '/home/user/My\\ Files/notes.txt',
      WORKSPACE,
      existsAmong('/home/user/My Files/notes.txt')
    );

    expect(result).toBe('/home/user/My Files/notes.txt ');
  });

  it('strips surrounding quotes (Windows Terminal / iTerm styles)', () => {
    const result = rewriteDroppedPaths(
      "'/home/user/My Files/notes.txt'",
      WORKSPACE,
      existsAmong('/home/user/My Files/notes.txt')
    );

    expect(result).toBe('/home/user/My Files/notes.txt ');
  });

  it('decodes file:// URIs', () => {
    const result = rewriteDroppedPaths(
      'file:///home/user/project/My%20File.txt',
      WORKSPACE,
      existsAmong('/home/user/project/My File.txt')
    );

    // Space-bearing workspace paths can't be @mentions (the mention grammar
    // breaks on spaces), so they stay absolute.
    expect(result).toBe('/home/user/project/My File.txt ');
  });

  it('leaves ordinary text pastes alone', () => {
    const exists = existsAmong('/home/user/project/a.ts');
    expect(rewriteDroppedPaths('hello world', WORKSPACE, exists)).toBeNull();
    expect(rewriteDroppedPaths('', WORKSPACE, exists)).toBeNull();
    expect(
      rewriteDroppedPaths('relative/path.ts', WORKSPACE, exists)
    ).toBeNull();
    // Looks like a path but doesn't exist: keep the paste untouched.
    expect(
      rewriteDroppedPaths('/home/user/project/missing.ts', WORKSPACE, exists)
    ).toBeNull();
    // A path mixed with prose is prose.
    expect(
      rewriteDroppedPaths(
        'see /home/user/project/a.ts please',
        WORKSPACE,
        exists
      )
    ).toBeNull();
  });
});
