import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Base directory for JustCode's on-disk state: the model-list cache, the saved
 * config, and similar. Defaults to `~/.cache/justcode`, but is overridable via
 * the `JUSTCODE_CACHE_DIR` env var so tests can redirect every cache write to a
 * throwaway folder instead of clobbering the user's real cache.
 */
export function cacheDirectory(): string {
  return (
    process.env.JUSTCODE_CACHE_DIR ?? join(homedir(), '.cache', 'justcode')
  );
}
