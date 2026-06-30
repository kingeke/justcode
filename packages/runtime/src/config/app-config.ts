import { join } from 'node:path';
import { cacheDirectory } from '@core/application/cache-dir';
import {
  readGlobalConfig,
  writeGlobalConfig,
} from '@runtime/persistence/global-config';
import {
  ProviderId,
  isCustomProviderId,
  CUSTOM_PROVIDER_PREFIX,
} from '@core/ports/provider-catalog';
import type {
  CustomProviderConfig,
  OAuthCredentials,
} from '@core/ports/provider-catalog';
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
  /** Whether local providers refetch their model list on every load (default true). */
  localModelAutoRefresh: boolean;
  /**
   * Whether lazy tool loading is on (default true): the model is shown only the
   * `lazy_load_tools` gateway up front and loads the rest by calling it. When
   * false, all tools are advertised from the first turn.
   */
  lazyToolLoading: boolean;
  openai: {
    apiKey: string | undefined;
    baseUrl: string;
    defaultModel: string;
    oauth: OAuthCredentials | undefined;
  };
  anthropic: {
    apiKey: string | undefined;
    baseUrl: string;
    oauth: OAuthCredentials | undefined;
  };
  copilot: {
    baseUrl: string;
    oauth: OAuthCredentials | undefined;
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
  /** User-added OpenAI-compatible providers, keyed by their namespaced id. */
  customProviders: Record<string, CustomProviderConfig>;
}

export async function loadAppConfig(
  configDirectory?: string
): Promise<AppConfig> {
  const targetConfigDir = configDirectory ?? cacheDirectory();

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

  const customProviders: Record<string, CustomProviderConfig> = {};
  for (const [id, saved] of Object.entries(
    configWithDefaults.providers ?? {}
  )) {
    if (!isCustomProviderId(id) || !saved) continue;
    customProviders[id] = {
      name: saved.name ?? id.slice(CUSTOM_PROVIDER_PREFIX.length),
      apiKey: saved.apiKey,
      baseUrl: saved.baseUrl ?? '',
      defaultModel: saved.defaultModel,
    };
  }

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
    localModelAutoRefresh: configWithDefaults.localModelAutoRefresh ?? true,
    lazyToolLoading: configWithDefaults.lazyToolLoading ?? true,
    openai: {
      apiKey: configWithDefaults.providers?.openai?.apiKey,
      baseUrl:
        configWithDefaults.providers?.openai?.baseUrl ??
        'https://api.openai.com/v1',
      defaultModel:
        configWithDefaults.providers?.openai?.defaultModel ?? 'gpt-4.1-mini',
      oauth: configWithDefaults.providers?.openai?.oauth,
    },
    anthropic: {
      apiKey: configWithDefaults.providers?.anthropic?.apiKey,
      baseUrl:
        configWithDefaults.providers?.anthropic?.baseUrl ??
        'https://api.anthropic.com',
      oauth: configWithDefaults.providers?.anthropic?.oauth,
    },
    copilot: {
      baseUrl:
        configWithDefaults.providers?.copilot?.baseUrl ??
        'https://api.githubcopilot.com',
      oauth: configWithDefaults.providers?.copilot?.oauth,
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
    customProviders,
  };
}

export function parseProviderId(
  value: string | undefined
): ProviderId | undefined {
  if (!value) return undefined;

  // Custom providers carry user-defined ids that aren't in the enum; they're
  // validated by presence in the config, not against a fixed list.
  if (isCustomProviderId(value)) return value as ProviderId;

  const match = Object.values(ProviderId).find((v) => v === value);
  if (match) return match;

  const valid = Object.values(ProviderId).join(', ');
  throw new Error(
    `Unsupported provider '${value}'. Expected one of: ${valid}.`
  );
}
