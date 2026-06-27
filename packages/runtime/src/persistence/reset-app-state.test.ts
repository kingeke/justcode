import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DEFAULT_SYSTEM_PROMPT } from '@core/application/system-prompt';
import { resetAppState } from '@runtime/persistence/reset-app-state';

vi.mock('node:fs/promises', () => ({
  rm: vi.fn(),
  writeFile: vi.fn(),
}));

describe('resetAppState', () => {
  const configDirectory = '/tmp/justcode';

  beforeEach(() => {
    vi.mocked(rm).mockReset();
    vi.mocked(writeFile).mockReset();
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);
  });

  it('rewrites config to defaults and clears sessions and pulled models', async () => {
    await resetAppState(configDirectory);

    expect(writeFile).toHaveBeenCalledWith(
      join(configDirectory, 'config.json'),
      `${JSON.stringify({ systemPrompt: DEFAULT_SYSTEM_PROMPT }, null, 2)}\n`,
      'utf8'
    );
    expect(rm).toHaveBeenCalledWith(join(configDirectory, 'sessions'), {
      recursive: true,
      force: true,
    });
    expect(rm).toHaveBeenCalledWith(join(configDirectory, 'models.json'), {
      force: true,
    });
  });
});
