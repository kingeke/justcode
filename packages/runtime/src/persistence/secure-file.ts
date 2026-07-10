import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
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
 * In-process write queue, keyed by target path. Two overlapping `writeFile`
 * calls on the same path each truncate and then write their chunks from offset
 * 0, so a shorter payload can leave the tail of a longer one behind — which is
 * how `config.json` ended up as valid-prefix-plus-garbage (`…} mode": "ask" }`)
 * and then failed to parse. Chaining the writes per path keeps them ordered.
 */
const writeQueues = new Map<string, Promise<void>>();

/** Runs `task` after any write already queued for `filePath` has settled. */
function enqueue(filePath: string, task: () => Promise<void>): Promise<void> {
  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  // Swallow the previous write's rejection here only: its own caller still sees
  // it. This keeps one failed write from failing every write that follows.
  const next = previous.catch(() => undefined).then(task);
  writeQueues.set(filePath, next);
  void next
    .catch(() => undefined)
    .finally(() => {
      if (writeQueues.get(filePath) === next) writeQueues.delete(filePath);
    });
  return next;
}

/** A unique sibling of `filePath` to stage the new contents in. */
function tempPathFor(filePath: string): string {
  const unique = `${process.pid.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${filePath}.${unique}.tmp`;
}

/**
 * Writes a file that may contain secrets (API keys, OAuth tokens) with
 * owner-only permissions, creating its directory with owner-only permissions
 * too.
 *
 * The write is atomic (staged in a sibling temp file, then renamed over the
 * target) and serialized per path, so a reader never sees a half-written file
 * and concurrent writers can't interleave their bytes.
 *
 * The explicit {@link chmod} is deliberate: `writeFile`'s `mode` is masked by
 * the process umask, so the staged file is tightened before it takes the
 * target's place.
 */
export async function writeSecureFile(
  filePath: string,
  contents: string
): Promise<void> {
  return enqueue(filePath, async () => {
    const directory = dirname(filePath);
    await mkdir(directory, {
      recursive: true,
      ...(isWindows ? {} : { mode: SECRET_DIR_MODE }),
    });

    const tempPath = tempPathFor(filePath);
    try {
      await writeFile(tempPath, contents, {
        encoding: 'utf8',
        ...(isWindows ? {} : { mode: SECRET_FILE_MODE }),
      });
      if (!isWindows) {
        // Tighten a pre-existing directory that predates this hardening. The
        // directory chmod is best-effort (a shared cache dir may not be ours to
        // re-mode); the file chmod must succeed since we just wrote it.
        try {
          await chmod(directory, SECRET_DIR_MODE);
        } catch {
          // best-effort only
        }
        await chmod(tempPath, SECRET_FILE_MODE);
      }
      // rename(2) replaces the target atomically, so the file is either the old
      // contents or the new ones — never a truncated mix of both.
      await rename(tempPath, filePath);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  });
}
