import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  readGlobalConfig,
  writeGlobalConfig,
} from '@runtime/persistence/global-config';
import { ProviderId } from '@core/ports/provider-catalog';
import type { GlobalConfig } from '@runtime/persistence/global-config';
import { DEFAULT_SYSTEM_PROMPT } from '@core/application/system-prompt';

export interface AppConfig {
  /** Provider to use on launch, or undefined when nothing is configured yet. */
  defaultProvider: ProviderId | undefined;
  /** Providers the user has explicitly connected (present in config.json). */
  configuredProviders: ProviderId[];
  configDirectory: string;
  sessionsDirectory: string;
  systemPrompt: string;
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
  const configWithDefaults =
    globalConfig.systemPrompt === undefined
      ? {
          ...globalConfig,
          systemPrompt: DEFAULT_SYSTEM_PROMPT,
        }
      : globalConfig;

  if (globalConfig.systemPrompt === undefined) {
    await writeGlobalConfig(targetConfigDir, configWithDefaults);
  }

  const configuredProviders = Object.keys(configWithDefaults.providers ?? {})
    .map((id) => parseProviderId(id))
    .filter((id): id is ProviderId => id !== undefined);

  // Nothing is used by default: only a provider the user explicitly connected
  // (the last one they picked, or any configured one) is selected. When none
  // exist, defaultProvider is undefined and the CLI shows the connect screen.
  const requestedProvider = parseProviderId(configWithDefaults.lastProvider);

  return {
    defaultProvider: requestedProvider ?? configuredProviders[0],
    configuredProviders,
    configDirectory: targetConfigDir,
    sessionsDirectory: join(targetConfigDir, 'sessions'),
    systemPrompt: configWithDefaults.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    openai: {
      apiKey: configWithDefaults.providers?.openai?.apiKey,
      baseUrl:
        configWithDefaults.providers?.openai?.baseUrl ??
        'https://api.openai.com/v1',
      defaultModel:
        configWithDefaults.providers?.openai?.defaultModel ?? 'gpt-4.1-mini',
    },
    ollama: {
      baseUrl:
        configWithDefaults.providers?.ollama?.baseUrl ??
        'http://127.0.0.1:11434',
      apiKey: configWithDefaults.providers?.ollama?.apiKey,
    },
    lmstudio: {
      baseUrl:
        configWithDefaults.providers?.lmstudio?.baseUrl ??
        'http://127.0.0.1:1234/v1',
      apiKey: configWithDefaults.providers?.lmstudio?.apiKey,
    },
    openrouter: {
      apiKey: configWithDefaults.providers?.openrouter?.apiKey,
      baseUrl:
        configWithDefaults.providers?.openrouter?.baseUrl ??
        'https://openrouter.ai/api/v1',
    },
    alibaba: {
      apiKey: configWithDefaults.providers?.alibaba?.apiKey,
      baseUrl:
        configWithDefaults.providers?.alibaba?.baseUrl ??
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
