// Bumps the product version in the root package.json (the single source of
// truth) by a semver release type, then syncs the extension manifest to match.
//
//   node scripts/bump-version.mjs patch   # 0.1.1 -> 0.1.2
//   node scripts/bump-version.mjs minor   # 0.1.1 -> 0.2.0
//   node scripts/bump-version.mjs major   # 0.1.1 -> 1.0.0
//
// Prints the new version and, under GitHub Actions, writes `version=<x.y.z>` to
// $GITHUB_OUTPUT so later steps can tag/commit with it. Used by the manual
// "Version" workflow; the actual build/publish runs off the tag it produces.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { syncExtensionVersion } from './sync-extension-version.mjs';

const RELEASE_TYPES = ['major', 'minor', 'patch'];

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootPkgPath = join(repoRoot, 'package.json');

/** Returns the next version string for `current` given a release `type`. */
export function nextVersion(current, type) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(current);
  if (!match) {
    throw new Error(`Cannot parse current version "${current}" as x.y.z`);
  }
  let [major, minor, patch] = match.slice(1).map(Number);
  switch (type) {
    case 'major':
      major += 1;
      minor = 0;
      patch = 0;
      break;
    case 'minor':
      minor += 1;
      patch = 0;
      break;
    case 'patch':
      patch += 1;
      break;
    default:
      throw new Error(
        `Unknown release type "${type}" (expected ${RELEASE_TYPES.join(', ')})`
      );
  }
  return `${major}.${minor}.${patch}`;
}

function main() {
  const type = process.argv[2];
  if (!RELEASE_TYPES.includes(type)) {
    console.error(
      `Usage: node scripts/bump-version.mjs <${RELEASE_TYPES.join('|')}>`
    );
    process.exit(1);
  }

  const raw = readFileSync(rootPkgPath, 'utf8');
  const current = JSON.parse(raw).version;
  const version = nextVersion(current, type);

  // Patch just the version line to preserve the file's formatting.
  writeFileSync(
    rootPkgPath,
    raw.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`)
  );
  syncExtensionVersion();

  console.log(`[justcode] ${current} -> ${version} (${type})`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  }
}

// Only run when invoked directly, so tests can import `nextVersion`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
