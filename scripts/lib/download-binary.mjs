// Downloads the prebuilt JustCode binary for the current platform from the
// project's GitHub Releases. Used by the npm postinstall and the launcher's
// lazy first-run fallback.
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, readFile, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { assetName } from './platform.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, '..', '..');

async function readPackageJson() {
  return JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'));
}

/** Derive "owner/repo" from package.json repository.url. */
function repoSlug(pkg) {
  const url = pkg?.repository?.url ?? '';
  const match = url.match(/github\.com[/:]([^/]+\/[^/.]+)/);
  if (!match) throw new Error('Could not determine GitHub repo from package.json "repository.url"');
  return match[1];
}

/** Public URL of the release asset for this version + platform. */
export async function binaryUrl() {
  const pkg = await readPackageJson();
  const slug = repoSlug(pkg);
  const tag = process.env.JUSTCODE_VERSION ?? `v${pkg.version}`;
  return `https://github.com/${slug}/releases/download/${tag}/${assetName()}`;
}

/** Default install location for the binary inside this package. */
export function defaultBinaryPath() {
  return join(pkgDir, 'dist-bin', assetName());
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure the platform binary exists at `dest`, downloading it if missing.
 * Returns the path to the executable. Idempotent.
 */
export async function ensureBinary(dest = defaultBinaryPath()) {
  if (await exists(dest)) return dest;

  const url = await binaryUrl();
  await mkdir(dirname(dest), { recursive: true });

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${url} (HTTP ${res.status})`);
  }

  // Write to a temp file first, then atomically move into place.
  const tmp = `${dest}.download`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  await chmod(tmp, 0o755);
  await rename(tmp, dest);
  return dest;
}
