import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createRuntimeServicesMock } = vi.hoisted(() => ({
  createRuntimeServicesMock: vi.fn(),
}));

vi.mock('@runtime/bootstrap/create-services', () => ({
  createRuntimeServices: createRuntimeServicesMock,
}));

import { createCli, normalizeArgv } from '@cli/bootstrap/create-cli';

describe('createCli', () => {
  beforeEach(() => {
    createRuntimeServicesMock.mockReset();
    createRuntimeServicesMock.mockReturnValue({
      providerId: 'lmstudio',
      listModelsService: {
        execute: vi.fn().mockResolvedValue([]),
      },
    });
  });

  it('passes the provider option to the models command', async () => {
    const program = createCli();

    await program.parseAsync(
      ['node', 'justcode', 'models', '--provider', 'lmstudio'],
      {
        from: 'node',
      }
    );

    expect(createRuntimeServicesMock).toHaveBeenCalledWith({
      providerId: 'lmstudio',
    });
  });

  it('normalizes short option equals syntax', () => {
    expect(
      normalizeArgv(['node', 'justcode', 'models', '-p=lmstudio'])
    ).toEqual(['node', 'justcode', 'models', '-p', 'lmstudio']);
  });
});
