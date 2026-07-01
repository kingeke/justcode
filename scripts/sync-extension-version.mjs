// Keeps the VS Code extension's manifest version in lockstep with the root
// package.json, which is the single source of truth for the product version.
//
// The extension's *runtime* version display already reads the root version via
// `@core/version` (APP_VERSION). The only reason a version lives in
// `apps/vscode/package.json` at all is that the VS Code Marketplace reads it
// from there at package time — so we derive it from the root rather than
// maintaining a second number by hand.
//
// Run directly (`node scripts/sync-extension-version.mjs`) or import
// `syncExtensionVersion()`; the extension build calls it so every package/publish
// picks up the current root version. Writes only when the value actually differs,
// so local dev builds don't churn the file.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootPkgPath = join(repoRoot, 'package.json');
const extPkgPath = join(repoRoot, 'apps', 'vscode', 'package.json');

/**
 * Copies the root package.json version into the extension manifest.
 * @returns {{ version: string, changed: boolean }}
 */
export function syncExtensionVersion() {
  const version = JSON.parse(readFileSync(rootPkgPath, 'utf8')).version;
  const raw = readFileSync(extPkgPath, 'utf8');
  const extPkg = JSON.parse(raw);

  if (extPkg.version === version) {
    return { version, changed: false };
  }

  // Preserve formatting/trailing newline by patching just the version line
  // rather than re-serializing (which would reorder/reindent the whole file).
  const updated = raw.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
  writeFileSync(extPkgPath, updated);
  return { version, changed: true };
}

// When run as a script, perform the sync and report what happened.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { version, changed } = syncExtensionVersion();
  console.log(
    changed
      ? `[justcode] synced extension version -> ${version}`
      : `[justcode] extension version already ${version}`
  );
}
