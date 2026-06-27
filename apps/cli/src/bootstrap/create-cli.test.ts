import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createInterfaceMock,
  createRuntimeServicesMock,
  loadAppConfigMock,
  resetAppStateMock,
} = vi.hoisted(() => ({
  createInterfaceMock: vi.fn(),
  createRuntimeServicesMock: vi.fn(),
  loadAppConfigMock: vi.fn(),
  resetAppStateMock: vi.fn(),
}));

vi.mock('node:readline/promises', () => ({
  createInterface: createInterfaceMock,
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
    createInterfaceMock.mockReset();
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
    createInterfaceMock.mockReturnValue({
      question: vi
        .fn()
        .mockResolvedValueOnce('y')
        .mockResolvedValueOnce('RESET'),
      close: vi.fn(),
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

  it('resets app state for the reset command after double confirmation', async () => {
    const program = createCli();

    await program.parseAsync(['node', 'justcode', 'reset'], {
      from: 'node',
    });

    expect(createInterfaceMock).toHaveBeenCalledWith({
      input: process.stdin,
      output: undefined,
    });
    expect(loadAppConfigMock).toHaveBeenCalled();
    expect(resetAppStateMock).toHaveBeenCalledWith('/tmp/justcode');
  });

  it('cancels reset when the first confirmation is declined', async () => {
    createInterfaceMock.mockReturnValueOnce({
      question: vi.fn().mockResolvedValueOnce('n'),
      close: vi.fn(),
    });

    const program = createCli();

    await program.parseAsync(['node', 'justcode', 'reset'], {
      from: 'node',
    });

    expect(loadAppConfigMock).not.toHaveBeenCalled();
    expect(resetAppStateMock).not.toHaveBeenCalled();
  });

  it('cancels reset when the second confirmation does not match RESET', async () => {
    createInterfaceMock.mockReturnValueOnce({
      question: vi
        .fn()
        .mockResolvedValueOnce('y')
        .mockResolvedValueOnce('reset'),
      close: vi.fn(),
    });

    const program = createCli();

    await program.parseAsync(['node', 'justcode', 'reset'], {
      from: 'node',
    });

    expect(loadAppConfigMock).not.toHaveBeenCalled();
    expect(resetAppStateMock).not.toHaveBeenCalled();
  });

  it('prints both reset confirmation prompts to stdout', async () => {
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);

    const program = createCli();

    await program.parseAsync(['node', 'justcode', 'reset'], {
      from: 'node',
    });

    expect(writeSpy).toHaveBeenCalledWith(
      'This will permanently reset JustCode to defaults and clear connected providers, pulled models, and sessions. This is irreversible.\n'
    );
    expect(writeSpy).toHaveBeenCalledWith('Continue? (y/N) ');
    expect(writeSpy).toHaveBeenCalledWith(
      'Type RESET to confirm this irreversible action: '
    );

    writeSpy.mockRestore();
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
