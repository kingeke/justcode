import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Base directory for JustCode's on-disk state: the model-list cache, the saved
 * config, and similar. Always `~/.cache/justcode` in real use — the
 * `JUSTCODE_CACHE_DIR` env var is internal test plumbing only (vitest.setup.ts
 * sets it so the suite writes to a throwaway folder instead of the user's real
 * cache) and is not a supported way to relocate the cache.
 */
export function cacheDirectory(): string {
  return (
    process.env.JUSTCODE_CACHE_DIR ?? join(homedir(), '.cache', 'justcode')
  );
}
