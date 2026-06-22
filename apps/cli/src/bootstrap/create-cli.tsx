import { render } from 'ink';
import { Command } from 'commander';
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
    .name('justcode')
    .description('Just Code CLI')
    .option(
      '-p, --provider <provider>',
      'Provider to use: openai, ollama, lmstudio'
    )
    .option('-m, --model <model>', 'Model to use')
    .option('-s, --session <session>', 'Session identifier', 'default')
    .action(async (options: SharedOptions) => {
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
    .action(async (options: SharedOptions) => {
      await runChat(options);
    });

  program
    .command('models')
    .description('List available models for a provider')
    .option(
      '-p, --provider <provider>',
      'Provider to use: openai, ollama, lmstudio'
    )
    .action(async (options: Pick<SharedOptions, 'provider'>) => {
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

async function runChat(options: SharedOptions): Promise<void> {
  const providerId = resolveProviderId(options.provider);
  const runtime = createRuntimeServices(providerId ? { providerId } : {});

  render(
    React.createElement(ChatApp, {
      providerId: runtime.providerId,
      chatSessionService: runtime.chatSessionService,
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
