import { Command, type OptionValues } from 'commander';
import React from 'react';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ProviderId } from '@core/ports/provider-catalog';
import { createRuntimeServices } from '@runtime/bootstrap/create-services';
import { DEFAULT_MAX_READ_LINES } from '@runtime/tools/read-file-tool';
import { loadAppConfig, parseProviderId } from '@runtime/config/app-config';
import {
  readGlobalConfig,
  writeGlobalConfig,
} from '@runtime/persistence/global-config';

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
  });

  // Merge into the persisted config so each write preserves the other fields.
  let currentConfig = savedConfig;
  const persistConfig = (patch: Partial<typeof savedConfig>): void => {
    currentConfig = { ...currentConfig, ...patch };
    void writeGlobalConfig(appConfig.configDirectory, currentConfig);
  };

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
      initialThinkingCollapsed: savedConfig.thinkingCollapsed ?? false,
      initialAutoApplyWrites: savedConfig.autoApplyWrites ?? false,
      initialExpandTools: savedConfig.expandTools ?? true,
      initialMaxReadLines:
        savedConfig.cache?.maxReadLines ?? DEFAULT_MAX_READ_LINES,
      onModelChange: (modelId: string, modelProviderId: string) => {
        persistConfig({ lastModel: modelId, lastProvider: modelProviderId });
      },
      onThinkingCollapsedChange: (collapsed: boolean) => {
        persistConfig({ thinkingCollapsed: collapsed });
      },
      onAutoApplyWritesChange: (autoApply: boolean) => {
        persistConfig({ autoApplyWrites: autoApply });
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
