import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export async function logModelsResponse(
  providerId: string,
  response: unknown
): Promise<void> {
  try {
    const dir = join(homedir(), '.cache', 'justcode');
    await mkdir(dir, { recursive: true });
    const file = join(dir, 'models.json');
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(await readFile(file, 'utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      // file doesn't exist yet
    }
    existing[providerId] = response;
    await writeFile(file, JSON.stringify(existing, null, 2) + '\n', 'utf8');
  } catch {
    // best-effort, never break the actual request
  }
}
