import { randomBytes } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Writes a file atomically: the content lands in a unique temp file in the
 * same directory, then a `rename` swaps it into place. Rename is atomic on the
 * same filesystem, so a reader never observes a half-written file — and two
 * concurrent writers each produce a complete file with last-write-wins,
 * instead of interleaving their chunks into JSON garbage (which is exactly
 * what plain `writeFile` does when, say, a stats save races a conversation
 * save for the same session).
 */
export async function writeFileAtomic(
  filePath: string,
  content: string
): Promise<void> {
  const tempPath = join(
    dirname(filePath),
    `.${randomBytes(8).toString('hex')}.tmp`
  );
  try {
    await writeFile(tempPath, content, 'utf8');
    await rename(tempPath, filePath);
  } catch (error) {
    // Best-effort cleanup so failed writes don't leave temp litter behind.
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}
