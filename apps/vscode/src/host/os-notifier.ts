import { execFile, execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { APP_NAME } from '@core/branding';
import { cacheDirectory } from '@core/application/cache-dir';

/**
 * Fire-and-forget OS notifications for moments the user should come back to
 * the chat (turn finished, a question/approval is waiting) while the VS Code
 * window isn't focused. No dependency: we drive the native notifier directly.
 *
 * - macOS: `terminal-notifier` when installed — `-sender com.microsoft.VSCode`
 *   replaces terminal-notifier's own logo with VS Code's and clicking the
 *   notification focuses VS Code; `-appIcon` shows our logo as the content
 *   image where the OS allows it. Falls back to `osascript`'s
 *   `display notification` otherwise.
 * - Linux: `notify-send` with our icon and app name.
 * - Windows: a PowerShell toast (best effort).
 */

export interface OsNotification {
  title: string;
  message: string;
  /** Absolute path to the app logo, used where the platform supports it. */
  iconPath?: string;
}

export interface NotifyCommand {
  command: string;
  args: string[];
}

/** VS Code's macOS bundle id — used so the toast carries VS Code's identity. */
const VSCODE_BUNDLE_ID = 'com.microsoft.VSCode';

/**
 * Builds the platform notifier invocation, or null when the platform has no
 * usable notifier. Pure, for tests; `hasTerminalNotifier` is probed once by
 * the caller.
 */
export function buildNotifyCommand(
  platform: NodeJS.Platform,
  notification: OsNotification,
  hasTerminalNotifier: boolean,
  /** True when sending via the rebranded bundle — its app icon IS our logo. */
  branded = false
): NotifyCommand | null {
  const { title, message, iconPath } = notification;
  if (platform === 'darwin') {
    if (hasTerminalNotifier) {
      return {
        command: 'terminal-notifier',
        args: [
          '-title',
          title,
          '-message',
          message,
          // Clicking the toast focuses the VS Code window. (`-sender` would
          // adopt VS Code's identity outright, but it makes terminal-notifier
          // hang — verified live.) With the branded bundle the app icon is
          // already our logo; otherwise ride it as icon/content image.
          '-activate',
          VSCODE_BUNDLE_ID,
          ...(iconPath && !branded
            ? ['-appIcon', iconPath, '-contentImage', iconPath]
            : []),
        ],
      };
    }
    return {
      command: 'osascript',
      args: [
        '-e',
        `display notification ${appleScriptString(message)} with title ${appleScriptString(title)}`,
      ],
    };
  }
  if (platform === 'linux') {
    return {
      command: 'notify-send',
      args: [
        '--app-name',
        APP_NAME,
        ...(iconPath ? ['--icon', iconPath] : []),
        title,
        message,
      ],
    };
  }
  if (platform === 'win32') {
    const script = [
      '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null;',
      '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null;',
      `$template = '<toast><visual><binding template="ToastGeneric"><text>${xmlEscape(title)}</text><text>${xmlEscape(message)}</text>${iconPath ? `<image placement="appLogoOverride" src="${xmlEscape(iconPath)}"/>` : ''}</binding></visual></toast>';`,
      '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument;',
      '$xml.LoadXml($template);',
      '$toast = New-Object Windows.UI.Notifications.ToastNotification $xml;',
      `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${APP_NAME}').Show($toast);`,
    ].join(' ');
    return {
      command: 'powershell',
      args: ['-NoProfile', '-NonInteractive', '-Command', script],
    };
  }
  return null;
}

/** Quotes a string for inline AppleScript (escapes backslashes and quotes). */
function appleScriptString(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;')
    .replace(/"/g, '&quot;');
}

/**
 * The extension host often runs with a minimal PATH (VS Code launched from the
 * Dock/Finder inherits no shell profile), so Homebrew/rbenv-installed tools
 * like terminal-notifier aren't findable through it. Search with an augmented
 * PATH covering the usual install locations.
 */
function augmentedEnv(): NodeJS.ProcessEnv {
  const extra = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    `${process.env.HOME ?? ''}/.rbenv/shims`,
    `${process.env.HOME ?? ''}/bin`,
  ].join(':');
  return { ...process.env, PATH: `${process.env.PATH ?? ''}:${extra}` };
}

// Probed once: the first terminal-notifier that actually runs (macOS only).
// Being on PATH isn't enough — broken wrappers (e.g. a ruby-gem rbenv shim for
// a missing binary) hang forever and can shadow the real Homebrew install, so
// known install locations are probed by absolute path first, each executed
// with a hard timeout, trusting only a prompt, successful exit.
let terminalNotifierPath: string | null | undefined;

function resolveTerminalNotifier(): string | null {
  if (terminalNotifierPath !== undefined) return terminalNotifierPath;
  const candidates = [
    '/opt/homebrew/bin/terminal-notifier',
    '/usr/local/bin/terminal-notifier',
    'terminal-notifier',
  ];
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['-help'], {
        stdio: 'ignore',
        env: augmentedEnv(),
        timeout: 1500,
      });
      terminalNotifierPath = candidate;
      return candidate;
    } catch {
      // Missing or hanging — try the next location.
    }
  }
  terminalNotifierPath = null;
  return null;
}

// The rebranded notifier bundle path (built once per machine), or null when it
// couldn't be built. macOS pins a notification's icon and app name to the
// *sending app*, so showing our logo (and dropping terminal-notifier's) means
// sending from our own app: a copy of terminal-notifier.app with our icon, our
// bundle id/name, banner style (no Show button), re-signed ad hoc.
let brandedNotifierPath: string | null | undefined;

function resolveBrandedNotifier(iconPath: string | undefined): string | null {
  if (brandedNotifierPath !== undefined) return brandedNotifierPath;
  brandedNotifierPath = null;
  if (!iconPath || !existsSync(iconPath)) return null;
  const sourceBinary = resolveTerminalNotifier();
  if (!sourceBinary) return null;
  try {
    const sourceApp = findNotifierApp(sourceBinary);
    if (!sourceApp) return null;
    const appDir = join(cacheDirectory(), 'notifier');
    const app = join(appDir, `${APP_NAME} Notifier.app`);
    const binary = join(app, 'Contents', 'MacOS', 'terminal-notifier');
    if (!existsSync(binary)) {
      const sh = (command: string, args: string[]): void => {
        execFileSync(command, args, { stdio: 'ignore', timeout: 15000 });
      };
      rmSync(app, { recursive: true, force: true });
      mkdirSync(appDir, { recursive: true });
      sh('cp', ['-R', sourceApp, app]);
      // Our logo as a proper .icns (all standard sizes from the 256px PNG).
      const iconset = join(
        mkdtempSync(join(tmpdir(), 'justcode-icns-')),
        'i.iconset'
      );
      mkdirSync(iconset, { recursive: true });
      for (const size of [16, 32, 64, 128, 256]) {
        sh('sips', [
          '-z',
          `${size}`,
          `${size}`,
          iconPath,
          '--out',
          join(iconset, `icon_${size}x${size}.png`),
        ]);
      }
      sh('cp', [
        join(iconset, 'icon_256x256.png'),
        join(iconset, 'icon_128x128@2x.png'),
      ]);
      sh('iconutil', [
        '-c',
        'icns',
        iconset,
        '-o',
        join(app, 'Contents', 'Resources', 'Terminal.icns'),
      ]);
      // Rebrand: our identity (fresh bundle id resets the user's notification
      // style to the plist's banner default — no action buttons).
      const plist = join(app, 'Contents', 'Info.plist');
      const plistBuddy = '/usr/libexec/PlistBuddy';
      sh(plistBuddy, [
        '-c',
        'Set :CFBundleIdentifier com.kingeke.justcode.notifier',
        plist,
      ]);
      sh(plistBuddy, ['-c', `Set :CFBundleName ${APP_NAME}`, plist]);
      sh(plistBuddy, ['-c', 'Set :NSUserNotificationAlertStyle banner', plist]);
      // Modifying the bundle broke its signature; arm64 macOS kills unsigned
      // binaries, so re-sign ad hoc.
      sh('codesign', ['--force', '--deep', '--sign', '-', app]);
    }
    // Trust it only if it actually runs.
    execFileSync(binary, ['-help'], { stdio: 'ignore', timeout: 1500 });
    brandedNotifierPath = binary;
    return binary;
  } catch (error) {
    console.error(`[${APP_NAME}] failed to build branded notifier`, error);
    return null;
  }
}

/**
 * Finds the terminal-notifier.app bundle behind a resolved binary: either the
 * binary already lives inside the .app, or it's Homebrew's bash wrapper whose
 * `exec "<path>"` line names the real binary.
 */
function findNotifierApp(binaryPath: string): string | null {
  const fromPath = (path: string): string | null => {
    const marker = '.app/Contents/MacOS/';
    const index = path.indexOf(marker);
    return index === -1 ? null : path.slice(0, index + '.app'.length);
  };
  const direct = fromPath(binaryPath);
  if (direct) return direct;
  try {
    if (binaryPath === 'terminal-notifier') return null;
    const content = readFileSync(binaryPath, 'utf8');
    const match = /exec "([^"]+)"/.exec(content);
    return match?.[1] ? fromPath(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Shows an OS notification. Failures never throw, but they are logged (see
 * Help → Toggle Developer Tools) so a missing notifier or a denied
 * notification permission is diagnosable; on macOS a terminal-notifier
 * failure falls back to osascript before giving up.
 */
export function notifyOS(notification: OsNotification): void {
  const brandedPath =
    process.platform === 'darwin'
      ? resolveBrandedNotifier(notification.iconPath)
      : null;
  const notifierPath =
    brandedPath ??
    (process.platform === 'darwin' ? resolveTerminalNotifier() : null);
  const primary = buildNotifyCommand(
    process.platform,
    notification,
    notifierPath !== null,
    brandedPath !== null
  );
  if (!primary) return;
  // Swap in the probed absolute binary (the bare name could re-resolve to a
  // broken shim shadowing the real install).
  if (primary.command === 'terminal-notifier' && notifierPath) {
    primary.command = notifierPath;
  }
  run(primary, () => {
    if (process.platform !== 'darwin' || primary.command === 'osascript') {
      return;
    }
    // terminal-notifier resolved but failed to run (stale shim, gem wrapper
    // without the binary…): mark it unusable and retry via osascript.
    terminalNotifierPath = null;
    const fallback = buildNotifyCommand('darwin', notification, false);
    if (fallback) run(fallback);
  });
}

function run(command: NotifyCommand, onError?: () => void): void {
  try {
    // The timeout kills a notifier that hangs (a broken shim would otherwise
    // swallow the notification silently, with no error to fall back on).
    execFile(
      command.command,
      command.args,
      { env: augmentedEnv(), timeout: 5000, killSignal: 'SIGKILL' },
      (error) => {
        if (!error) return;
        console.error(
          `[${APP_NAME}] notification via ${command.command} failed`,
          error
        );
        onError?.();
      }
    );
  } catch (error) {
    console.error(
      `[${APP_NAME}] notification via ${command.command} failed`,
      error
    );
    onError?.();
  }
}
