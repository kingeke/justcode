import { execFileSync } from 'node:child_process';

export function pasteFromClipboard(): string | undefined {
  try {
    return execFileSync('pbpaste', { encoding: 'utf8' }).replace(/\r\n/g, '\n');
  } catch {
    return undefined;
  }
}

export function normalizeSingleLinePaste(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
