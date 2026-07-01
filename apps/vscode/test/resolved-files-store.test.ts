import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  deleteResolvedFiles,
  pruneResolvedFiles,
  readResolvedFiles,
  writeResolvedFiles,
} from '@ext/host/resolved-files-store';

describe('resolved-files store', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'resolved-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips a session resolution', async () => {
    await writeResolvedFiles(dir, 'sess-a', {
      'src/app.ts': { editCount: 2, baseline: 'old' },
    });

    expect(await readResolvedFiles(dir, 'sess-a')).toEqual({
      'src/app.ts': { editCount: 2, baseline: 'old' },
    });
    // A different session is unaffected.
    expect(await readResolvedFiles(dir, 'sess-b')).toEqual({});
  });

  it('keeps sessions independent and drops empty maps', async () => {
    await writeResolvedFiles(dir, 'sess-a', {
      'a.ts': { editCount: 1, baseline: '' },
    });
    await writeResolvedFiles(dir, 'sess-b', {
      'b.ts': { editCount: 1, baseline: '' },
    });

    // Clearing one session leaves the other intact.
    await writeResolvedFiles(dir, 'sess-a', {});
    expect(await readResolvedFiles(dir, 'sess-a')).toEqual({});
    expect(await readResolvedFiles(dir, 'sess-b')).toEqual({
      'b.ts': { editCount: 1, baseline: '' },
    });
  });

  it('deletes a session entry', async () => {
    await writeResolvedFiles(dir, 'sess-a', {
      'a.ts': { editCount: 1, baseline: '' },
    });
    await deleteResolvedFiles(dir, 'sess-a');
    expect(await readResolvedFiles(dir, 'sess-a')).toEqual({});
  });

  it('returns empty for a missing store', async () => {
    expect(await readResolvedFiles(dir, 'nope')).toEqual({});
  });

  it('prunes entries for sessions that no longer exist', async () => {
    await writeResolvedFiles(dir, 'live', {
      'a.ts': { editCount: 1, baseline: 'x' },
    });
    await writeResolvedFiles(dir, 'orphan-1', {
      'b.ts': { editCount: 1, baseline: 'y' },
    });
    await writeResolvedFiles(dir, 'orphan-2', {
      'c.ts': { editCount: 1, baseline: 'z' },
    });

    await pruneResolvedFiles(dir, ['live']);

    expect(await readResolvedFiles(dir, 'live')).toEqual({
      'a.ts': { editCount: 1, baseline: 'x' },
    });
    expect(await readResolvedFiles(dir, 'orphan-1')).toEqual({});
    expect(await readResolvedFiles(dir, 'orphan-2')).toEqual({});
  });

  it('leaves the store untouched when every session is live', async () => {
    await writeResolvedFiles(dir, 'live', {
      'a.ts': { editCount: 1, baseline: 'x' },
    });
    await pruneResolvedFiles(dir, ['live', 'other']);
    expect(await readResolvedFiles(dir, 'live')).toEqual({
      'a.ts': { editCount: 1, baseline: 'x' },
    });
  });
});
