import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Owner-only file mode (rw-------) for on-disk secrets. */
export const SECRET_FILE_MODE = 0o600;
/** Owner-only directory mode (rwx------) for the config dir holding secrets. */
export const SECRET_DIR_MODE = 0o700;

// POSIX permission bits are honored on macOS/Linux (our brew/curl targets). On
// Windows, NTFS ignores mode bits — Node's `mode`/`chmod` only toggles the
// read-only attribute — so we skip them there and rely on the config living
// under the per-user profile dir, which Windows already ACL-restricts to the
// owning user. This is NOT full cross-OS enforcement, just best-effort on POSIX.
const isWindows = process.platform === 'win32';

/**
 * Writes a file that may contain secrets (API keys, OAuth tokens) with
 * owner-only permissions, creating its directory with owner-only permissions
 * too. The trailing {@link chmod} is deliberate: `writeFile`'s `mode` only
 * applies when the file is first created, so an already-existing (and possibly
 * world-readable) file is tightened on every write.
 */
export async function writeSecureFile(
  filePath: string,
  contents: string
): Promise<void> {
  const directory = dirname(filePath);
  await mkdir(directory, {
    recursive: true,
    ...(isWindows ? {} : { mode: SECRET_DIR_MODE }),
  });
  await writeFile(filePath, contents, {
    encoding: 'utf8',
    ...(isWindows ? {} : { mode: SECRET_FILE_MODE }),
  });
  if (!isWindows) {
    // Tighten a pre-existing directory/file that predates this hardening. The
    // directory chmod is best-effort (a shared cache dir may not be ours to
    // re-mode); the file chmod must succeed since we just wrote it.
    try {
      await chmod(directory, SECRET_DIR_MODE);
    } catch {
      // best-effort only
    }
    await chmod(filePath, SECRET_FILE_MODE);
  }
}
