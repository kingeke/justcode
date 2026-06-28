import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ClipboardImage {
  /** MIME type, e.g. `image/png`. */
  mediaType: string;
  /** Base64-encoded image bytes (no `data:` URI prefix). */
  data: string;
}

/**
 * Reads an image from the OS clipboard, if one is present, as base64 PNG bytes.
 * Terminals don't deliver pasted image data over stdin, so we go straight to the
 * platform clipboard via its native CLI. Returns undefined when the clipboard
 * holds no image (or the platform tools are unavailable) — callers treat that as
 * "this was a normal text paste".
 */
export function readClipboardImage(): ClipboardImage | undefined {
  try {
    if (process.platform === 'darwin') {
      return readClipboardImageMac();
    }
    if (process.platform === 'win32') {
      return readClipboardImageWindows();
    }
    return readClipboardImageLinux();
  } catch {
    return undefined;
  }
}

// macOS: AppleScript can coerce the clipboard to PNG (`«class PNGf»`) regardless
// of whether the original is a PNG, TIFF, or screenshot, then write the raw
// bytes to a temp file we read back. `clipboard info` is checked first so a
// text-only clipboard returns fast without provoking an AppleScript error.
function readClipboardImageMac(): ClipboardImage | undefined {
  // stderr is silenced on every call: converting some clipboard formats (e.g. a
  // JPEG2000 screenshot) makes Core Graphics print warnings like "Error creating
  // a JP2 color space: falling back to sRGB" — harmless, but they'd otherwise
  // corrupt the TUI. The conversion still succeeds.
  const info = execFileSync('osascript', ['-e', 'clipboard info'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (!/PNGf|TIFF|GIFf|JPEG|«class PNGf»/i.test(info)) {
    return undefined;
  }

  const dir = mkdtempSync(join(tmpdir(), 'justcode-clip-'));
  const file = join(dir, 'clipboard.png');
  try {
    execFileSync(
      'osascript',
      [
        '-e',
        'set theFile to (POSIX file "' + file + '")',
        '-e',
        'set fileRef to (open for access theFile with write permission)',
        '-e',
        'set eof fileRef to 0',
        '-e',
        'write (the clipboard as «class PNGf») to fileRef',
        '-e',
        'close access fileRef',
      ],
      { stdio: 'ignore' }
    );
    const bytes = readFileSync(file);
    if (bytes.length === 0) return undefined;
    return { mediaType: 'image/png', data: bytes.toString('base64') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Linux: try the Wayland (`wl-paste`) then X11 (`xclip`) clipboard tools, asking
// each for PNG bytes. Whichever is installed and holds an image wins.
function readClipboardImageLinux(): ClipboardImage | undefined {
  const candidates: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['wl-paste', ['--type', 'image/png']],
    ['xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']],
  ];

  for (const [command, args] of candidates) {
    try {
      const bytes = execFileSync(command, args, {
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      if (bytes.length > 0 && isPng(bytes)) {
        return { mediaType: 'image/png', data: bytes.toString('base64') };
      }
    } catch {
      // Try the next tool (missing binary, or no image on the clipboard).
    }
  }
  return undefined;
}

// Windows: PowerShell pulls the clipboard image and writes a PNG to a temp file.
function readClipboardImageWindows(): ClipboardImage | undefined {
  const dir = mkdtempSync(join(tmpdir(), 'justcode-clip-'));
  const file = join(dir, 'clipboard.png');
  try {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms;',
      '$img = [System.Windows.Forms.Clipboard]::GetImage();',
      'if ($img -ne $null) {',
      `  $img.Save('${file}', [System.Drawing.Imaging.ImageFormat]::Png);`,
      '}',
    ].join(' ');
    execFileSync('powershell', ['-NoProfile', '-Command', script], {
      stdio: 'ignore',
    });
    const bytes = readFileSync(file);
    if (bytes.length === 0 || !isPng(bytes)) return undefined;
    return { mediaType: 'image/png', data: bytes.toString('base64') };
  } catch {
    return undefined;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function isPng(bytes: Buffer): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

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
