import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ProviderId } from '@core/ports/chat-model';
import { PROVIDER_BY_ID } from '@core/ports/provider-catalog';
import type { ProviderConfig } from '@core/ports/provider-catalog';

export interface GlobalConfig {
  lastModel?: string;
  lastProvider?: string;
  providers?: Partial<Record<ProviderId, ProviderConfig>>;
  thinkingCollapsed?: boolean;
  /** When true, file-writing tools run without per-call confirmation. */
  autoApplyWrites?: boolean;
  /** Tunables for how the agent reads from the workspace. */
  cache?: {
    /** Max bytes returned by a single file read before it is windowed. */
    maxReadBytes?: number;
  };
}

export async function readGlobalConfig(
  configDirectory: string
): Promise<GlobalConfig> {
  try {
    const raw = await readFile(join(configDirectory, 'config.json'), 'utf8');
    return JSON.parse(raw) as GlobalConfig;
  } catch {
    return {};
  }
}

export async function writeGlobalConfig(
  configDirectory: string,
  config: GlobalConfig
): Promise<void> {
  await mkdir(configDirectory, { recursive: true });
  await writeFile(
    join(configDirectory, 'config.json'),
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8'
  );
}

export function mergeProviderConfig(
  config: GlobalConfig,
  providerId: ProviderId,
  providerConfig: ProviderConfig
): GlobalConfig {
  return {
    ...config,
    providers: {
      ...config.providers,
      [providerId]: providerConfig,
    },
  };
}

export function getProviderConfig(
  config: GlobalConfig,
  providerId: ProviderId
): ProviderConfig | undefined {
  return config.providers?.[providerId];
}

export function buildEnvFromGlobalConfig(
  baseEnv: NodeJS.ProcessEnv,
  config: GlobalConfig
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };

  for (const provider of Object.values(PROVIDER_BY_ID)) {
    const saved = config.providers?.[provider.id];
    if (!saved) continue;

    if (saved.apiKey && provider.apiKeyEnvVar) {
      env[provider.apiKeyEnvVar] = saved.apiKey;
    }

    if (saved.baseUrl && provider.baseUrlEnvVar) {
      env[provider.baseUrlEnvVar] = saved.baseUrl;
    }
  }

  return env;
}
