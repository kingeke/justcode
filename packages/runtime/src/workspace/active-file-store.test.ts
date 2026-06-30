import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  readActiveFile,
  writeActiveFile,
} from '@runtime/workspace/active-file-store';

describe('active-file-store', () => {
  let cacheDir: string;
  let previousCacheDir: string | undefined;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'justcode-active-file-'));
    previousCacheDir = process.env.JUSTCODE_CACHE_DIR;
    process.env.JUSTCODE_CACHE_DIR = cacheDir;
  });

  afterEach(() => {
    if (previousCacheDir === undefined) delete process.env.JUSTCODE_CACHE_DIR;
    else process.env.JUSTCODE_CACHE_DIR = previousCacheDir;
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('returns undefined when nothing has been recorded', () => {
    expect(readActiveFile('/work/proj')).toBeUndefined();
  });

  it('round-trips an active file per workspace root', () => {
    writeActiveFile('/work/proj', 'src/app.ts');
    writeActiveFile('/work/other', 'lib/index.ts');

    expect(readActiveFile('/work/proj')).toBe('src/app.ts');
    expect(readActiveFile('/work/other')).toBe('lib/index.ts');
  });

  it('overwrites the previous file and clears it when unset', () => {
    writeActiveFile('/work/proj', 'src/app.ts');
    writeActiveFile('/work/proj', 'src/other.ts');
    expect(readActiveFile('/work/proj')).toBe('src/other.ts');

    writeActiveFile('/work/proj', undefined);
    expect(readActiveFile('/work/proj')).toBeUndefined();
  });
});
