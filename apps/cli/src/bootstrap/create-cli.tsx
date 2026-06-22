import { render } from 'ink';
import { Command, type OptionValues } from 'commander';
import React from 'react';

import { ChatApp } from '@cli/ui/chat-app';
import type { ProviderId } from '@core/ports/chat-model';
import { createRuntimeServices } from '@runtime/bootstrap/create-services';
import { parseProviderId } from '@runtime/config/app-config';

interface SharedOptions {
  provider?: string;
  model?: string;
  session?: string;
}

export function createCli(): Command {
  const program = new Command();

  program
    .name('JustCode')
    .description('Just Code CLI')
    .option(
      '-p, --provider <provider>',
      'Provider to use: openai, ollama, lmstudio'
    )
    .option('-m, --model <model>', 'Model to use')
    .option('-s, --session <session>', 'Session identifier', 'default')
    .action(async (...args: unknown[]) => {
      const options = getActionOptions<SharedOptions>(args);
      await runChat(options);
    });

  program
    .command('chat')
    .description('Launch the interactive chat UI')
    .option(
      '-p, --provider <provider>',
      'Provider to use: openai, ollama, lmstudio'
    )
    .option('-m, --model <model>', 'Model to use')
    .option('-s, --session <session>', 'Session identifier', 'default')
    .action(async (...args: unknown[]) => {
      const options = getActionOptions<SharedOptions>(args);
      await runChat(options);
    });

  program
    .command('models')
    .description('List available models for a provider')
    .option(
      '-p, --provider <provider>',
      'Provider to use: openai, ollama, lmstudio'
    )
    .action(async (...args: unknown[]) => {
      const options = getActionOptions<Pick<SharedOptions, 'provider'>>(args);
      const providerId = resolveProviderId(options.provider);
      const runtime = createRuntimeServices(providerId ? { providerId } : {});
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
  const providerId = resolveProviderId(options.provider);
  const runtime = createRuntimeServices(providerId ? { providerId } : {});

  render(
    React.createElement(ChatApp, {
      providerId: runtime.providerId,
      chatSessionService: runtime.chatSessionService,
      promptAttachmentService: runtime.promptAttachmentService,
      sessionId: options.session ?? 'default',
      requestedModel: options.model,
    })
  );
}

function resolveProviderId(
  provider: string | undefined
): ProviderId | undefined {
  return parseProviderId(provider);
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
