import { homedir } from 'node:os';
import { join } from 'node:path';

import { readGlobalConfig } from '../persistence/global-config';
import { ProviderId } from '@core/ports/chat-model';
import type { GlobalConfig } from '../persistence/global-config';

export interface AppConfig {
  /** Provider to use on launch, or undefined when nothing is configured yet. */
  defaultProvider: ProviderId | undefined;
  /** Providers the user has explicitly connected (present in config.json). */
  configuredProviders: ProviderId[];
  configDirectory: string;
  sessionsDirectory: string;
  openai: {
    apiKey: string | undefined;
    baseUrl: string;
    defaultModel: string;
  };
  ollama: {
    baseUrl: string;
    apiKey?: string | undefined;
  };
  lmstudio: {
    baseUrl: string;
    apiKey?: string | undefined;
  };
  openrouter: {
    apiKey: string | undefined;
    baseUrl: string;
  };
  alibaba: {
    apiKey: string | undefined;
    baseUrl: string;
  };
}

export async function loadAppConfig(
  configDirectory?: string
): Promise<AppConfig> {
  const targetConfigDir =
    configDirectory ?? join(homedir(), '.cache', 'justcode');

  const globalConfig = await readGlobalConfig(targetConfigDir);

  const configuredProviders = Object.keys(globalConfig.providers ?? {})
    .map((id) => parseProviderId(id))
    .filter((id): id is ProviderId => id !== undefined);

  // Nothing is used by default: only a provider the user explicitly connected
  // (the last one they picked, or any configured one) is selected. When none
  // exist, defaultProvider is undefined and the CLI shows the connect screen.
  const requestedProvider = parseProviderId(globalConfig.lastProvider);

  return {
    defaultProvider: requestedProvider ?? configuredProviders[0],
    configuredProviders,
    configDirectory: targetConfigDir,
    sessionsDirectory: join(targetConfigDir, 'sessions'),
    openai: {
      apiKey: globalConfig.providers?.openai?.apiKey,
      baseUrl: globalConfig.providers?.openai?.baseUrl ?? 'https://api.openai.com/v1',
      defaultModel: globalConfig.providers?.openai?.defaultModel ?? 'gpt-4.1-mini',
    },
    ollama: {
      baseUrl: globalConfig.providers?.ollama?.baseUrl ?? 'http://127.0.0.1:11434',
      apiKey: globalConfig.providers?.ollama?.apiKey,
    },
    lmstudio: {
      baseUrl: globalConfig.providers?.lmstudio?.baseUrl ?? 'http://127.0.0.1:1234/v1',
      apiKey: globalConfig.providers?.lmstudio?.apiKey,
    },
    openrouter: {
      apiKey: globalConfig.providers?.openrouter?.apiKey,
      baseUrl: globalConfig.providers?.openrouter?.baseUrl ?? 'https://openrouter.ai/api/v1',
    },
    alibaba: {
      apiKey: globalConfig.providers?.alibaba?.apiKey,
      baseUrl:
        globalConfig.providers?.alibaba?.baseUrl ??
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
    },
  };
}

export function parseProviderId(
  value: string | undefined
): ProviderId | undefined {
  if (!value) return undefined;

  const match = Object.values(ProviderId).find((v) => v === value);
  if (match) return match;

  const valid = Object.values(ProviderId).join(', ');
  throw new Error(
    `Unsupported provider '${value}'. Expected one of: ${valid}.`
  );
}
