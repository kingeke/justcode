import { execFileSync } from 'node:child_process';

export function pasteFromClipboard(): string | undefined {
  try {
    return execFileSync('pbpaste', { encoding: 'utf8' }).replace(/\r\n/g, '\n');
  } catch {
    return undefined;
  }
}

// Write text to the OS clipboard via the platform's native CLI. Used as a
// fallback when the terminal doesn't support OSC52 copy. Returns true on
// success. (OSC52 — via renderer.copyToClipboardOSC52 — is preferred since it
// also works over SSH.)
export function copyToClipboard(text: string): boolean {
  const candidates: ReadonlyArray<readonly [string, readonly string[]]> =
    process.platform === 'darwin'
      ? [['pbcopy', []]]
      : process.platform === 'win32'
        ? [['clip', []]]
        : [
            ['wl-copy', []],
            ['xclip', ['-selection', 'clipboard']],
            ['xsel', ['--clipboard', '--input']],
          ];

  for (const [command, args] of candidates) {
    try {
      execFileSync(command, args, { input: text });
      return true;
    } catch {
      // Try the next candidate (binary missing or no display).
    }
  }
  return false;
}

export function normalizeSingleLinePaste(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
