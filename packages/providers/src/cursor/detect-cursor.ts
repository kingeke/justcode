import { access, constants } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Locations the Cursor CLI installer uses (`curl https://cursor.com/install`
 * symlinks both `cursor-agent` and `agent` into `~/.local/bin`), checked after
 * PATH so an explicit PATH entry always wins.
 */
const FALLBACK_DIRS = (): string[] => [
  join(homedir(), '.local', 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
];

const WINDOWS_EXTENSIONS = ['.exe', '.cmd', '.bat'];

function candidateNames(base: string): string[] {
  return process.platform === 'win32'
    ? WINDOWS_EXTENSIONS.map((extension) => `${base}${extension}`)
    : [base];
}

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
 * Finds the user's Cursor CLI executable the way a shell would. The installer
 * names the binary `cursor-agent` with an `agent` alias; `cursor-agent` is
 * preferred everywhere because a bare `agent` on PATH could be an unrelated
 * program — the plain name is only trusted in the installer's own directories.
 * Returns undefined when none is found, so callers can surface an install hint.
 */
export async function detectCursorExecutable(): Promise<string | undefined> {
  const pathDirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const dir of [...pathDirs, ...FALLBACK_DIRS()]) {
    for (const name of candidateNames('cursor-agent')) {
      const candidate = join(dir, name);
      if (await isExecutable(candidate)) return candidate;
    }
  }
  for (const dir of FALLBACK_DIRS()) {
    for (const name of candidateNames('agent')) {
      const candidate = join(dir, name);
      if (await isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}
