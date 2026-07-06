import { access, constants, readdir } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Locations the Claude Code installer commonly uses, checked after PATH so an
 * explicit PATH entry always wins. Windows resolution goes through PATH with
 * the executable extensions below.
 */
const FALLBACK_DIRS = (): string[] => [
  join(homedir(), '.local', 'bin'),
  join(homedir(), '.claude', 'local'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
];

const WINDOWS_EXTENSIONS = ['.exe', '.cmd', '.bat'];

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(
      path,
      process.platform === 'win32' ? constants.F_OK : constants.X_OK
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds the user's `claude` executable the way a shell would: first hit on
 * PATH, then the installer's common locations. Returns undefined when none is
 * found — the connect flow then leaves the field blank and the Agent SDK
 * falls back to its own resolution.
 *
 * Used to prefill the connect flow's executable-path input (mirroring how
 * provider base URLs are prefilled), so users with several installs (e.g.
 * `claude` and `claude-w` for work) can see and change what will be used.
 */
export async function detectClaudeExecutable(): Promise<string | undefined> {
  const names =
    process.platform === 'win32'
      ? WINDOWS_EXTENSIONS.map((ext) => `claude${ext}`)
      : ['claude'];
  const pathDirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const dir of [...pathDirs, ...FALLBACK_DIRS()]) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (await isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

/**
 * Finds candidate Claude Code config directories in the home folder — the
 * default `~/.claude` plus any siblings like `~/.claude-work` that users create
 * for a second account (typically driven by a `CLAUDE_CONFIG_DIR=~/.claude-work
 * claude` shell alias). Returns absolute paths, `~/.claude` first when present,
 * so the connect flow can show the user which accounts are available to pick.
 */
export async function detectClaudeConfigDirs(): Promise<string[]> {
  const home = homedir();
  let entries: string[];
  try {
    entries = (await readdir(home, { withFileTypes: true }))
      .filter(
        (entry) => entry.isDirectory() && entry.name.startsWith('.claude')
      )
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  // Default first, then the rest alphabetically for a stable, predictable order.
  entries.sort((a, b) =>
    a === '.claude' ? -1 : b === '.claude' ? 1 : a.localeCompare(b)
  );
  return entries.map((name) => join(home, name));
}
