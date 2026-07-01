import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@cli': resolve(rootDir, 'apps/cli/src'),
      '@core': resolve(rootDir, 'packages/core/src'),
      '@providers': resolve(rootDir, 'packages/providers/src'),
      '@runtime': resolve(rootDir, 'packages/runtime/src'),
      '@ext': resolve(rootDir, 'apps/vscode/src'),
    },
  },
  test: {
    environment: 'node',
    // Redirects cache writes to a throwaway folder so tests never touch the
    // real ~/.cache/justcode.
    setupFiles: ['./vitest.setup.ts'],
    // `opencode/` is a vendored reference checkout (gitignored); never run its
    // tests. `.claude/` holds git worktrees and agent scratch that duplicate the
    // source tree — running those stale copies double-counts and breaks on
    // in-progress branches, so exclude it too.
    exclude: ['**/node_modules/**', '**/dist/**', 'opencode/**', '.claude/**'],
    coverage: {
      reporter: ['text', 'lcov'],
    },
  },
});
