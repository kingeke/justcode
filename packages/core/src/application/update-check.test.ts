import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  compareVersions,
  detectChannel,
  getUpdateNotice,
  upgradeCommandFor,
} from '@core/application/update-check';

describe('compareVersions', () => {
  it('orders by major, minor, then patch', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('1.3.0', '1.2.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.5', '0.1.4')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('ignores a leading v and missing segments', () => {
    expect(compareVersions('v1.2', '1.2.0')).toBe(0);
    expect(compareVersions('v0.2.0', 'v0.1.9')).toBeGreaterThan(0);
  });
});

describe('detectChannel', () => {
  it('recognizes the curl install path', () => {
    expect(detectChannel('/Users/me/.justcode/bin/justcode', '')).toBe('curl');
  });

  it('recognizes an npm install path', () => {
    expect(
      detectChannel('/usr/lib/node_modules/just-code/dist-bin/justcode', '')
    ).toBe('npm');
  });

  it('recognizes a Homebrew cellar path', () => {
    expect(
      detectChannel('/opt/homebrew/Cellar/justcode/0.1.0/bin/justcode', '')
    ).toBe('brew');
  });

  it('falls back to unknown for an unrecognized path', () => {
    expect(detectChannel('/somewhere/custom/justcode', '')).toBe('unknown');
  });
});

describe('upgradeCommandFor', () => {
  it('gives the package-manager command per channel', () => {
    expect(upgradeCommandFor('npm')).toContain('npm update -g');
    // `brew update` must come first so a stale local tap is refreshed before
    // the upgrade (otherwise `brew upgrade` is a no-op on an old formula).
    expect(upgradeCommandFor('brew')).toContain('brew update && brew upgrade');
    expect(upgradeCommandFor('curl')).toContain('install.sh');
    expect(upgradeCommandFor('unknown')).toMatch(/releases/i);
  });
});

describe('getUpdateNotice', () => {
  let dir: string;
  const saved = {
    cache: process.env.JUSTCODE_CACHE_DIR,
    debug: process.env.JUSTCODE_DEBUG,
    noCheck: process.env.JUSTCODE_NO_UPDATE_CHECK,
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'jc-update-'));
    process.env.JUSTCODE_CACHE_DIR = dir;
    delete process.env.JUSTCODE_DEBUG;
    delete process.env.JUSTCODE_NO_UPDATE_CHECK;
  });

  afterEach(async () => {
    if (saved.cache === undefined) delete process.env.JUSTCODE_CACHE_DIR;
    else process.env.JUSTCODE_CACHE_DIR = saved.cache;
    if (saved.debug === undefined) delete process.env.JUSTCODE_DEBUG;
    else process.env.JUSTCODE_DEBUG = saved.debug;
    if (saved.noCheck === undefined)
      delete process.env.JUSTCODE_NO_UPDATE_CHECK;
    else process.env.JUSTCODE_NO_UPDATE_CHECK = saved.noCheck;
    await rm(dir, { recursive: true, force: true });
  });

  // Writes a fresh cache entry (checkedAt = now) so getUpdateNotice reads it
  // without triggering the background network refresh.
  async function seedCache(latestVersion: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'update-check.json'),
      JSON.stringify({ checkedAt: new Date().toISOString(), latestVersion })
    );
  }

  it('returns a notice when the cached release is newer', async () => {
    await seedCache('9.9.9');
    const notice = await getUpdateNotice('0.1.0');
    expect(notice).not.toBeNull();
    expect(notice?.latestVersion).toBe('9.9.9');
    expect(notice?.currentVersion).toBe('0.1.0');
    expect(notice?.upgradeCommand).toBeTruthy();
  });

  it('returns null when already up to date', async () => {
    await seedCache('0.1.0');
    expect(await getUpdateNotice('0.1.0')).toBeNull();
  });

  it('returns null when no check has run yet', async () => {
    expect(await getUpdateNotice('0.1.0')).toBeNull();
  });

  it('is disabled by JUSTCODE_NO_UPDATE_CHECK', async () => {
    await seedCache('9.9.9');
    process.env.JUSTCODE_NO_UPDATE_CHECK = '1';
    expect(await getUpdateNotice('0.1.0')).toBeNull();
  });

  it('is skipped in local dev (JUSTCODE_DEBUG)', async () => {
    await seedCache('9.9.9');
    process.env.JUSTCODE_DEBUG = '1';
    expect(await getUpdateNotice('0.1.0')).toBeNull();
  });
});
