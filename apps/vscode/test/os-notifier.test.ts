import { describe, expect, it } from 'vitest';

import { buildNotifyCommand } from '@ext/host/os-notifier';

const NOTIFICATION = {
  title: 'JustCode',
  message: 'Done: created style.css',
  iconPath: '/ext/media/icon.png',
};

describe('buildNotifyCommand', () => {
  it('uses terminal-notifier on macOS with VS Code identity and our icon', () => {
    const cmd = buildNotifyCommand('darwin', NOTIFICATION, true);

    expect(cmd?.command).toBe('terminal-notifier');
    expect(cmd?.args).toContain('JustCode');
    expect(cmd?.args).toContain('Done: created style.css');
    // Clicking focuses VS Code; the app logo rides as icon + content image.
    // `-sender` must NOT be used: it makes terminal-notifier hang (verified).
    expect(cmd?.args).not.toContain('-sender');
    expect(cmd?.args).toContain('-activate');
    expect(cmd?.args).toContain('com.microsoft.VSCode');
    expect(cmd?.args).toContain('-appIcon');
    expect(cmd?.args).toContain('-contentImage');
    expect(cmd?.args).toContain('/ext/media/icon.png');
  });

  it('falls back to osascript on macOS, quoting the strings safely', () => {
    const cmd = buildNotifyCommand(
      'darwin',
      { title: 'JustCode', message: 'He said "done" \\ finished' },
      false
    );

    expect(cmd?.command).toBe('osascript');
    expect(cmd?.args[1]).toContain('display notification');
    expect(cmd?.args[1]).toContain('\\"done\\"');
    expect(cmd?.args[1]).toContain('with title "JustCode"');
  });

  it('uses notify-send on Linux with the app name and icon', () => {
    const cmd = buildNotifyCommand('linux', NOTIFICATION, false);

    expect(cmd?.command).toBe('notify-send');
    expect(cmd?.args).toContain('--app-name');
    expect(cmd?.args).toContain('--icon');
    expect(cmd?.args).toContain('/ext/media/icon.png');
  });

  it('builds a PowerShell toast on Windows with XML-escaped text', () => {
    const cmd = buildNotifyCommand(
      'win32',
      { title: 'JustCode', message: 'a < b & c' },
      false
    );

    expect(cmd?.command).toBe('powershell');
    const script = cmd?.args.at(-1) ?? '';
    expect(script).toContain('ToastNotificationManager');
    expect(script).toContain('a &lt; b &amp; c');
  });

  it('omits icon flags for the branded bundle (its app icon IS the logo)', () => {
    const cmd = buildNotifyCommand('darwin', NOTIFICATION, true, true);

    expect(cmd?.command).toBe('terminal-notifier');
    expect(cmd?.args).not.toContain('-appIcon');
    expect(cmd?.args).not.toContain('-contentImage');
    expect(cmd?.args).toContain('-activate');
  });

  it('returns null on platforms without a notifier', () => {
    expect(buildNotifyCommand('freebsd', NOTIFICATION, false)).toBeNull();
  });
});
