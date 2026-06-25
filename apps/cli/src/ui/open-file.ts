import { spawn } from 'node:child_process';

export async function openFileInEditor(filePath: string): Promise<void> {
  const editor = process.env.VISUAL?.trim() || process.env.EDITOR?.trim();
  const command = editor ?? getSystemOpenCommand();
  const args = editor ? [filePath] : getSystemOpenArgs(filePath);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Failed to open '${filePath}' with '${command}'.`));
    });
  });
}

function getSystemOpenCommand(): string {
  if (process.platform === 'darwin') {
    return 'open';
  }

  if (process.platform === 'win32') {
    return 'cmd';
  }

  return 'xdg-open';
}

function getSystemOpenArgs(filePath: string): string[] {
  if (process.platform === 'win32') {
    return ['/c', 'start', '', filePath];
  }

  return [filePath];
}
