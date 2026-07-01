import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ASK_SYSTEM_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  PLAN_SYSTEM_PROMPT,
} from '@core/application/system-prompt';
import { resetAppState } from '@runtime/persistence/reset-app-state';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn(),
}));

describe('resetAppState', () => {
  const configDirectory = '/tmp/justcode';

  beforeEach(() => {
    vi.mocked(mkdir).mockReset();
    vi.mocked(rm).mockReset();
    vi.mocked(writeFile).mockReset();
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);
  });

  it('rewrites config to defaults, resets all mode prompts, and clears providers before pulled models', async () => {
    await resetAppState(configDirectory);

    expect(mkdir).toHaveBeenCalledWith(configDirectory, { recursive: true });
    expect(writeFile).toHaveBeenCalledWith(
      join(configDirectory, 'config.json'),
      `${JSON.stringify(
        {
          systemPrompt: DEFAULT_SYSTEM_PROMPT,
          askSystemPrompt: ASK_SYSTEM_PROMPT,
          planSystemPrompt: PLAN_SYSTEM_PROMPT,
        },
        null,
        2
      )}\n`,
      'utf8'
    );
    expect(rm).toHaveBeenNthCalledWith(
      1,
      join(configDirectory, 'providers.json'),
      {
        force: true,
      }
    );
    expect(rm).toHaveBeenNthCalledWith(
      2,
      join(configDirectory, 'models.json'),
      {
        force: true,
      }
    );
    expect(rm).toHaveBeenNthCalledWith(3, join(configDirectory, 'sessions'), {
      recursive: true,
      force: true,
    });
  });
});
