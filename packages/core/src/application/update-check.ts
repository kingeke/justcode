import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import pkg from '../../../../package.json';
import { cacheDirectory } from '@core/application/cache-dir';
import { APP_NAME, APP_NAME_LOWERED } from '@core/branding';
import { APP_VERSION, appUserAgent } from '@core/version';

/**
 * Notify-only update check. On startup the CLI shows a one-line banner when a
 * newer release exists, and prints the upgrade command for the channel the user
 * installed through. It never blocks, never downgrades, and sends nothing about
 * the user — it only reads the public GitHub Releases API.
 *
 * The banner shown on a given run comes from the *previously* cached check; the
 * current run refreshes that cache in the background (throttled to once a day)
 * for the next launch. This mirrors how npm/brew surface updates and keeps
 * startup free of any network wait.
 */

/** How the running binary was installed, which decides the upgrade command. */
export type UpdateChannel = 'curl' | 'npm' | 'brew' | 'unknown';

export interface UpdateNotice {
  currentVersion: string;
  latestVersion: string;
  channel: UpdateChannel;
  /** Human-readable instruction, e.g. "brew update && brew upgrade justcode". */
  upgradeCommand: string;
}

interface UpdateCacheFile {
  /** ISO timestamp of the last successful (or attempted) check. */
  checkedAt: string;
  /** Latest release version seen, without the leading `v` (e.g. "0.2.0"). */
  latestVersion: string;
}

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;

const cacheFile = (): string => join(cacheDirectory(), 'update-check.json');

/** "owner/repo" parsed from package.json `repository.url`. */
function repoSlug(): string | null {
  const url = (pkg as { repository?: { url?: string } }).repository?.url ?? '';
  const match = url.match(/github\.com[/:]([^/]+\/[^/.]+)/);
  return match?.[1] ?? null;
}

/**
 * Compares two dotted numeric versions. Returns a negative number when `a` is
 * older than `b`, positive when newer, 0 when equal. Non-numeric/pre-release
 * suffixes are ignored (only the leading `x.y.z` is compared), which is all the
 * notify path needs.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] =>
    v
      .replace(/^v/, '')
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Detects how this binary was installed by inspecting its on-disk path.
 * Resolves symlinks first so Homebrew's `bin` symlink into the Cellar is seen.
 * Falls back to `unknown` when nothing matches (e.g. a manually placed binary).
 */
export function detectChannel(
  execPath: string = process.execPath,
  argvPath: string = process.argv[1] ?? ''
): UpdateChannel {
  const resolve = (p: string): string => {
    if (!p) return '';
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  // The compiled binary's own path is the strongest signal; the npm launcher
  // runs under node, so also consider the script path it spawned.
  const candidates = [resolve(execPath), resolve(argvPath), execPath, argvPath];

  for (const path of candidates) {
    if (!path) continue;
    if (/[\\/](Cellar|homebrew|linuxbrew)[\\/]/.test(path)) return 'brew';
    if (path.includes('node_modules')) return 'npm';
    // curl installs land in `$HOME/.justcode/bin/justcode`.
    if (new RegExp(`[\\\\/]\\.${APP_NAME_LOWERED}[\\\\/]bin[\\\\/]`).test(path))
      return 'curl';
  }
  return 'unknown';
}

/** The upgrade instruction to print for a given install channel. */
export function upgradeCommandFor(channel: UpdateChannel): string {
  const slug = repoSlug();
  const releases = slug
    ? `https://github.com/${slug}/releases/latest`
    : `${APP_NAME} releases`;
  switch (channel) {
    case 'npm':
      return `npm update -g ${pkg.name}`;
    case 'brew':
      // `brew update` first so the tap's formula bump is fetched; without it a
      // stale local tap makes `brew upgrade` a confusing no-op ("already
      // installed") even when a newer release exists.
      return `brew update && brew upgrade ${APP_NAME_LOWERED}`;
    case 'curl':
      return slug
        ? `curl -fsSL https://raw.githubusercontent.com/${slug}/main/scripts/install.sh | sh`
        : `re-run the ${APP_NAME} install script`;
    default:
      return `download the latest release: ${releases}`;
  }
}

async function readCache(): Promise<UpdateCacheFile | null> {
  try {
    return JSON.parse(await readFile(cacheFile(), 'utf8')) as UpdateCacheFile;
  } catch {
    return null;
  }
}

async function writeCache(entry: UpdateCacheFile): Promise<void> {
  try {
    await mkdir(cacheDirectory(), { recursive: true });
    // Temp-write then atomic rename so a reader never sees a half-written file.
    const tmp = `${cacheFile()}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, JSON.stringify(entry, null, 2) + '\n', 'utf8');
    await rename(tmp, cacheFile());
  } catch {
    // Best-effort: a failed cache write must never break startup.
  }
}

/** Fetches the latest release tag from GitHub, or null on any failure. */
export async function fetchLatestVersion(): Promise<string | null> {
  const slug = repoSlug();
  if (!slug) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.github.com/repos/${slug}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': appUserAgent(),
        },
        signal: controller.signal,
      }
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { tag_name?: string };
    const tag = body.tag_name?.trim();
    return tag ? tag.replace(/^v/, '') : null;
  } catch {
    // Offline, rate-limited, timed out, or malformed — silently give up.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** True when the cache is missing or older than the once-a-day interval. */
function isStale(cache: UpdateCacheFile | null, now: number): boolean {
  if (!cache) return true;
  const then = new Date(cache.checkedAt).getTime();
  if (Number.isNaN(then)) return true;
  return now - then >= CHECK_INTERVAL_MS;
}

/**
 * Returns an {@link UpdateNotice} when a newer release than the running version
 * is already known from a prior check, otherwise null. Also kicks off a
 * background refresh (fire-and-forget, throttled to once a day) so the next
 * launch has fresh data. Never throws and never awaits the network.
 *
 * Disabled entirely when `JUSTCODE_NO_UPDATE_CHECK` is set, and skipped in local
 * development (`JUSTCODE_DEBUG`) so an unreleased dev build doesn't nag.
 */
export async function getUpdateNotice(
  currentVersion: string = APP_VERSION
): Promise<UpdateNotice | null> {
  if (process.env.JUSTCODE_NO_UPDATE_CHECK || process.env.JUSTCODE_DEBUG) {
    return null;
  }

  const cache = await readCache();

  if (isStale(cache, Date.now())) {
    // Refresh in the background for the *next* run; don't block this one.
    void fetchLatestVersion().then((latestVersion) => {
      if (latestVersion) {
        void writeCache({ checkedAt: new Date().toISOString(), latestVersion });
      }
    });
  }

  if (!cache?.latestVersion) return null;
  if (compareVersions(cache.latestVersion, currentVersion) <= 0) return null;

  const channel = detectChannel();
  return {
    currentVersion,
    latestVersion: cache.latestVersion,
    channel,
    upgradeCommand: upgradeCommandFor(channel),
  };
}
