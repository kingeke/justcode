import { spawn } from 'node:child_process';
import { platform } from 'node:os';

/**
 * Opens {@link url} in the user's default browser. Best-effort: if the platform
 * launcher fails (e.g. headless/SSH), it resolves false so callers can fall back
 * to printing the URL for the user to open manually.
 */
export async function openBrowser(url: string): Promise<boolean> {
  const [command, args] = launcher(url);
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, {
        stdio: 'ignore',
        detached: true,
      });
      child.on('error', () => resolve(false));
      child.unref();
      // Give spawn a tick to surface an immediate failure before resolving true.
      setTimeout(() => resolve(true), 100);
    } catch {
      resolve(false);
    }
  });
}

function launcher(url: string): [string, string[]] {
  switch (platform()) {
    case 'darwin':
      return ['open', [url]];
    case 'win32':
      return ['cmd', ['/c', 'start', '', url]];
    default:
      return ['xdg-open', [url]];
  }
}
