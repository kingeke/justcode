import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ProviderId } from '@core/ports/provider-catalog';
import type { ProviderConfig } from '@core/ports/provider-catalog';

export interface GlobalConfig {
  lastModel?: string;
  lastProvider?: string;
  providers?: Partial<Record<ProviderId, ProviderConfig>>;
  systemPrompt?: string;
  thinkingCollapsed?: boolean;
  /** When true, file-writing tools run without per-call confirmation. */
  autoApplyWrites?: boolean;
  /** When true, finished tool calls render their full input/output inline. */
  expandTools?: boolean;
  /** Tunables for how the agent reads from the workspace. */
  cache?: {
    /** Max lines returned by a single file read before it is paged. */
    maxReadLines?: number;
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
