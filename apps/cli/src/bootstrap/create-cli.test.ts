import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createRuntimeServicesMock, loadAppConfigMock, resetAppStateMock } =
  vi.hoisted(() => ({
    createRuntimeServicesMock: vi.fn(),
    loadAppConfigMock: vi.fn(),
    resetAppStateMock: vi.fn(),
  }));

vi.mock('@runtime/bootstrap/create-services', () => ({
  createRuntimeServices: createRuntimeServicesMock,
}));

vi.mock('@runtime/config/app-config', async () => {
  const actual = await vi.importActual<
    typeof import('@runtime/config/app-config')
  >('@runtime/config/app-config');

  return {
    ...actual,
    loadAppConfig: loadAppConfigMock,
  };
});

vi.mock('@runtime/persistence/reset-app-state', () => ({
  resetAppState: resetAppStateMock,
}));

import {
  createCli,
  normalizeArgv,
  resolveStartupProviderSelection,
} from '@cli/bootstrap/create-cli';

describe('createCli', () => {
  beforeEach(() => {
    createRuntimeServicesMock.mockReset();
    loadAppConfigMock.mockReset();
    resetAppStateMock.mockReset();

    createRuntimeServicesMock.mockReturnValue({
      providerId: 'lmstudio',
      listModelsService: {
        execute: vi.fn().mockResolvedValue([]),
      },
    });
    loadAppConfigMock.mockResolvedValue({
      configDirectory: '/tmp/justcode',
    });
    resetAppStateMock.mockResolvedValue(undefined);
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

  it('resets app state for the reset command', async () => {
    const program = createCli();

    await program.parseAsync(['node', 'justcode', 'reset'], {
      from: 'node',
    });

    expect(loadAppConfigMock).toHaveBeenCalled();
    expect(resetAppStateMock).toHaveBeenCalledWith('/tmp/justcode');
  });

  it('forces connect flow when the provider flag is not configured', () => {
    expect(
      resolveStartupProviderSelection(
        { provider: 'lmstudio' },
        { providers: { openai: {} } }
      )
    ).toEqual({ providerId: undefined, allowDefaultProvider: false });
  });

  it('uses the requested provider when it is configured', () => {
    expect(
      resolveStartupProviderSelection(
        { provider: 'lmstudio' },
        { providers: { lmstudio: {} } }
      )
    ).toEqual({ providerId: 'lmstudio', allowDefaultProvider: false });
  });
});
