import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Redirect every on-disk cache write (model lists, saved config) to a throwaway
// folder at the repo root so the test suite never clobbers the developer's real
// ~/.cache/justcode. The folder is gitignored; see cacheDirectory().
const testCacheDir = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '.test-cache'
);
mkdirSync(testCacheDir, { recursive: true });
process.env.JUSTCODE_CACHE_DIR = testCacheDir;
