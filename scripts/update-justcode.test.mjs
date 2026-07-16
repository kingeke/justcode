import { describe, expect, it } from 'vitest';

import { pickInstallTarget } from './update-justcode.mjs';

const repoDir = '/home/dev/projects/justcode';
const defaultPath = '/home/dev/.justcode/bin/justcode';

describe('pickInstallTarget', () => {
  it('picks the installed binary found on PATH', () => {
    const target = pickInstallTarget(
      [
        {
          path: '/home/dev/.justcode/bin/justcode',
          realPath: '/home/dev/.justcode/bin/justcode',
        },
      ],
      { repoDir, defaultPath }
    );
    expect(target).toBe('/home/dev/.justcode/bin/justcode');
  });

  it('skips the local dev symlink that resolves into the repo', () => {
    const target = pickInstallTarget(
      [
        {
          path: '/usr/local/bin/justcode',
          realPath: `${repoDir}/dist-bin/justcode-darwin-arm64`,
        },
        {
          path: '/home/dev/.justcode/bin/justcode',
          realPath: '/home/dev/.justcode/bin/justcode',
        },
      ],
      { repoDir, defaultPath }
    );
    expect(target).toBe('/home/dev/.justcode/bin/justcode');
  });

  it('falls back to the installer location when nothing is on PATH', () => {
    expect(pickInstallTarget([], { repoDir, defaultPath })).toBe(defaultPath);
  });

  it('falls back when every candidate is a repo symlink', () => {
    const target = pickInstallTarget(
      [
        {
          path: '/usr/local/bin/justcode',
          realPath: `${repoDir}/dist-bin/justcode-linux-x64`,
        },
      ],
      { repoDir, defaultPath }
    );
    expect(target).toBe(defaultPath);
  });

  it('does not mistake sibling directories for the repo', () => {
    // e.g. /home/dev/projects/justcode-other must not match the repo prefix.
    const target = pickInstallTarget(
      [
        {
          path: `${repoDir}-other/bin/justcode`,
          realPath: `${repoDir}-other/bin/justcode`,
        },
      ],
      { repoDir, defaultPath }
    );
    expect(target).toBe(`${repoDir}-other/bin/justcode`);
  });

  it('keeps the original PATH entry even when it is a non-repo symlink', () => {
    // A symlink pointing outside the repo (e.g. a Homebrew shim) is the real
    // install; replace it at the path the shell resolves.
    const target = pickInstallTarget(
      [
        {
          path: '/opt/homebrew/bin/justcode',
          realPath: '/opt/homebrew/Cellar/justcode/0.4.4/bin/justcode',
        },
      ],
      { repoDir, defaultPath }
    );
    expect(target).toBe('/opt/homebrew/bin/justcode');
  });
});
