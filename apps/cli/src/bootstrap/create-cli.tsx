import { Command, type OptionValues } from 'commander';
import React from 'react';
import { version as appVersion } from '../../../../package.json';
import { createInterface } from 'node:readline/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  deleteDebugLog,
  setDebugLogDirectory,
} from '@core/application/debug-log';
import { cacheDirectory } from '@core/application/cache-dir';
import type { ProviderId } from '@core/ports/provider-catalog';
import { createRuntimeServices } from '@runtime/bootstrap/create-services';
import { DEFAULT_MAX_READ_LINES } from '@runtime/tools/read-file-tool';
import { DEFAULT_MAX_HISTORY_MESSAGES } from '@core/application/history-window';
import { loadAppConfig, parseProviderId } from '@runtime/config/app-config';
import {
  readGlobalConfig,
  writeGlobalConfig,
} from '@runtime/persistence/global-config';
import { resetAppState } from '@runtime/persistence/reset-app-state';

interface SharedOptions {
  provider?: string;
  model?: string;
  session?: string;
}

interface StartupProviderSelection {
  providerId: ProviderId | undefined;
  allowDefaultProvider: boolean;
}

export function createCli(): Command {
  const program = new Command();

  // Keep debug.log out of whatever project the CLI is launched in: write it to
  // the shared cache dir (~/.cache/justcode) instead of process.cwd(), matching
  // the VSCode host. Must run before any logging or the startup cleanup below.
  setDebugLogDirectory(cacheDirectory());
  void deleteDebugLog();

  program
    .name('JustCode')
    .description('Just Code CLI')
    .option(
      '-p, --provider <provider>',
      'Provider to use: openai, openrouter, alibaba, ollama, lmstudio'
    )
    .option('-m, --model <model>', 'Model to use')
    .option('-s, --session <session>', 'Session identifier')
    .action(async (...args: unknown[]) => {
      const options = getActionOptions<SharedOptions>(args);
      await runChat(options);
    });

  program
    .command('chat')
    .description('Launch the interactive chat UI')
    .option(
      '-p, --provider <provider>',
      'Provider to use: openai, openrouter, alibaba, ollama, lmstudio'
    )
    .option('-m, --model <model>', 'Model to use')
    .option('-s, --session <session>', 'Session identifier')
    .action(async (...args: unknown[]) => {
      const options = getActionOptions<SharedOptions>(args);
      await runChat(options);
    });

  program
    .command('models')
    .description('List available models for a provider')
    .option(
      '-p, --provider <provider>',
      'Provider to use: openai, openrouter, alibaba, ollama, lmstudio'
    )
    .action(async (...args: unknown[]) => {
      const options = getActionOptions<Pick<SharedOptions, 'provider'>>(args);
      const providerId = resolveProviderId(options.provider);
      const runtime = await createRuntimeServices(
        providerId ? { providerId } : {}
      );

      if (!runtime.providerId) {
        process.stdout.write(
          'No provider is configured. Run `justcode` and use /connect first.\n'
        );
        return;
      }

      const models = await runtime.listModelsService.execute();

      if (models.length === 0) {
        process.stdout.write(
          `No models are available for provider '${runtime.providerId}'.\n`
        );
        return;
      }

      process.stdout.write(`${runtime.providerId} models:\n`);
      for (const model of models) {
        process.stdout.write(`- ${model.id}\n`);
      }
    });

  program
    .command('reset')
    .description(
      'Reset app defaults and clear connected providers, pulled models, and sessions'
    )
    .action(async () => {
      const confirmed = await confirmReset();
      if (!confirmed) {
        process.stdout.write('Reset cancelled.\n');
        return;
      }

      const appConfig = await loadAppConfig();
      await resetAppState(appConfig.configDirectory);
      process.stdout.write('Reset complete.\n');
    });

  return program;
}

export function normalizeArgv(argv: readonly string[]): string[] {
  return argv.flatMap((argument) => {
    if (
      !argument.startsWith('-') ||
      argument.startsWith('--') ||
      !argument.includes('=')
    ) {
      return [argument];
    }

    const separatorIndex = argument.indexOf('=');
    const optionName = argument.slice(0, separatorIndex);
    const optionValue = argument.slice(separatorIndex + 1);

    if (!['-p', '-m', '-s'].includes(optionName) || !optionValue) {
      return [argument];
    }

    return [optionName, optionValue];
  });
}

async function confirmReset(): Promise<boolean> {
  process.stdout.write(
    'This will permanently reset JustCode to defaults and clear connected providers, pulled models, and sessions. This is irreversible.\n'
  );

  const readline = createInterface({
    input: process.stdin,
    output: undefined,
  });

  try {
    const firstConfirmation = await readline.question('Continue? (y/N) ');
    if (firstConfirmation.trim().toLowerCase() !== 'y') {
      return false;
    }

    const secondConfirmation = await readline.question(
      'Type RESET to confirm this irreversible action: '
    );
    return secondConfirmation.trim() === 'RESET';
  } finally {
    readline.close();
  }
}

async function runChat(options: SharedOptions): Promise<void> {
  const appConfig = await loadAppConfig();
  const savedConfig = await readGlobalConfig(appConfig.configDirectory);

  const startupProvider = resolveStartupProviderSelection(options, savedConfig);

  const runtime = await createRuntimeServices({
    ...(startupProvider.providerId
      ? { providerId: startupProvider.providerId }
      : {}),
    ...(startupProvider.allowDefaultProvider
      ? {}
      : { allowDefaultProvider: false }),
    configDirectory: appConfig.configDirectory,
    ...(savedConfig.cache?.maxReadLines
      ? { maxReadLines: savedConfig.cache.maxReadLines }
      : {}),
    // 0 is a valid value ("off"), so probe for presence rather than truthiness.
    ...(savedConfig.cache?.maxHistoryMessages !== undefined
      ? { maxHistoryMessages: savedConfig.cache.maxHistoryMessages }
      : {}),
  });

  // Merge into the persisted config so each write preserves the other fields.
  let currentConfig = savedConfig;
  const persistConfig = (patch: Partial<typeof savedConfig>): void => {
    currentConfig = { ...currentConfig, ...patch };
    void writeGlobalConfig(appConfig.configDirectory, currentConfig);
  };

  // Point OpenTUI at our embedded, self-contained tree-sitter worker before it
  // ever spawns one, so markdown highlights in the compiled binary (see
  // configure-tree-sitter.ts). Must run before the first <markdown> renders.
  const { configureTreeSitterWorker } =
    await import('@cli/bootstrap/configure-tree-sitter');
  configureTreeSitterWorker();

  // Lazily load the OpenTUI renderer + UI so the `models` command (and unit tests
  // that import createCli) never pull the native FFI renderer into their module graph.
  const { createCliRenderer } = await import('@opentui/core');
  const { createRoot } = await import('@opentui/react');
  const { ChatApp } = await import('@cli/ui/chat-app');

  const renderer = await createCliRenderer({
    // We arm/handle Ctrl+C ourselves (double-press to exit); mouse drives the
    // scrollback wheel in the chat view.
    exitOnCtrlC: false,
    useMouse: true,
  });
  const exit = (): void => {
    renderer.destroy();
    process.exit(0);
  };

  createRoot(renderer).render(
    React.createElement(ChatApp, {
      onExit: exit,
      version: appVersion,
      providerId: runtime.providerId,
      savedConfig,
      configFilePath: join(appConfig.configDirectory, 'config.json'),
      chatSessionService: runtime.chatSessionService,
      promptAttachmentService: runtime.promptAttachmentService,
      sessionId: options.session ?? randomUUID(),
      requestedModel: options.model ?? savedConfig.lastModel,
      allProviders: runtime.allProviders,
      createProvider: runtime.createProvider,
      onConfigChange: (nextConfig) => {
        persistConfig(nextConfig);
      },
      // Reset replaces the config wholesale: discard the stale in-memory config
      // (which still holds connected providers) so persistConfig can't merge
      // them back on the next write.
      onConfigReset: (nextConfig) => {
        currentConfig = nextConfig;
        void writeGlobalConfig(appConfig.configDirectory, currentConfig);
      },
      initialThinkingCollapsed: savedConfig.thinkingCollapsed ?? false,
      initialAutoApprove: savedConfig.autoApprove ?? false,
      initialLocalModelAutoRefresh: savedConfig.localModelAutoRefresh ?? true,
      initialLazyToolLoading: savedConfig.lazyToolLoading ?? true,
      initialExpandTools: savedConfig.expandTools ?? true,
      initialMaxReadLines:
        savedConfig.cache?.maxReadLines ?? DEFAULT_MAX_READ_LINES,
      initialMaxHistoryMessages:
        savedConfig.cache?.maxHistoryMessages ?? DEFAULT_MAX_HISTORY_MESSAGES,
      ...(savedConfig.reasoningEffortByModel
        ? { initialReasoningEffortByModel: savedConfig.reasoningEffortByModel }
        : {}),
      onModelChange: (modelId: string, modelProviderId: string) => {
        persistConfig({ lastModel: modelId, lastProvider: modelProviderId });
      },
      onThinkingCollapsedChange: (collapsed: boolean) => {
        persistConfig({ thinkingCollapsed: collapsed });
      },
      onAutoApproveChange: (autoApply: boolean) => {
        persistConfig({ autoApprove: autoApply });
      },
      onLocalModelAutoRefreshChange: (enabled: boolean) => {
        runtime.setLocalModelAutoRefresh(enabled);
        persistConfig({ localModelAutoRefresh: enabled });
      },
      onLazyToolLoadingChange: (enabled: boolean) => {
        runtime.setLazyToolLoading(enabled);
        persistConfig({ lazyToolLoading: enabled });
      },
      onExpandToolsChange: (expand: boolean) => {
        persistConfig({ expandTools: expand });
      },
      onMaxReadLinesChange: (lines: number) => {
        runtime.setMaxReadLines(lines);
        persistConfig({
          cache: { ...currentConfig.cache, maxReadLines: lines },
        });
      },
      onMaxHistoryMessagesChange: (count: number) => {
        runtime.setMaxHistoryMessages(count);
        persistConfig({
          cache: { ...currentConfig.cache, maxHistoryMessages: count },
        });
      },
      onReasoningEffortChange: (providerId, modelId, effort) => {
        persistConfig({
          reasoningEffortByModel: {
            ...currentConfig.reasoningEffortByModel,
            [providerId]: {
              ...currentConfig.reasoningEffortByModel?.[providerId],
              [modelId]: effort,
            },
          },
        });
      },
    })
  );
}

function resolveProviderId(
  provider: string | undefined
): ProviderId | undefined {
  return parseProviderId(provider);
}

export function resolveStartupProviderSelection(
  options: SharedOptions,
  savedConfig: {
    lastProvider?: string;
    providers?: Partial<Record<ProviderId, unknown>>;
  }
): StartupProviderSelection {
  const requestedProviderId = resolveProviderId(options.provider);

  if (options.provider) {
    if (
      requestedProviderId &&
      savedConfig.providers?.[requestedProviderId] !== undefined
    ) {
      return {
        providerId: requestedProviderId,
        allowDefaultProvider: false,
      };
    }

    return {
      providerId: undefined,
      allowDefaultProvider: false,
    };
  }

  return {
    providerId: parseProviderId(savedConfig.lastProvider),
    allowDefaultProvider: true,
  };
}

function getActionOptions<TOptions extends OptionValues>(
  args: unknown[]
): TOptions {
  const command = args.at(-1);
  if (!(command instanceof Command)) {
    throw new Error('Failed to resolve command options.');
  }

  return command.optsWithGlobals<TOptions>();
}
