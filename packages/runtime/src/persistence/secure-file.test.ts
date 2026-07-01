import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeGlobalConfig } from '@runtime/persistence/global-config';
import { writeSecureFile } from '@runtime/persistence/secure-file';

// POSIX-only: on Windows NTFS ignores these bits, so the assertions don't apply.
const describePosix = process.platform === 'win32' ? describe.skip : describe;

async function modeOctal(path: string): Promise<string> {
  const info = await stat(path);
  return (info.mode & 0o777).toString(8);
}

describePosix('writeSecureFile', () => {
  it('writes the file owner-only and the directory owner-only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'justcode-secure-'));
    const filePath = join(dir, 'nested', 'secret.json');

    await writeSecureFile(filePath, '{"token":"abc"}');

    expect(await modeOctal(filePath)).toBe('600');
    expect(await modeOctal(join(dir, 'nested'))).toBe('700');
  });

  it('tightens an already-existing world-readable file on write', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'justcode-secure-'));
    const filePath = join(dir, 'secret.json');
    await writeFile(filePath, 'old', { mode: 0o644 });
    expect(await modeOctal(filePath)).toBe('644');

    await writeSecureFile(filePath, 'new');

    expect(await modeOctal(filePath)).toBe('600');
  });
});

describePosix('writeGlobalConfig', () => {
  it('persists config.json with owner-only permissions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'justcode-config-'));

    await writeGlobalConfig(dir, {
      providers: { openai: { apiKey: 'sk-secret' } },
    });

    expect(await modeOctal(join(dir, 'config.json'))).toBe('600');
  });
});
