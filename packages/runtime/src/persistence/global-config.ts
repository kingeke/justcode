import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ReasoningEffort } from '@core/ports/chat-model';
import { ProviderId } from '@core/ports/provider-catalog';
import type { ProviderConfig } from '@core/ports/provider-catalog';

export interface GlobalConfig {
  lastModel?: string;
  lastProvider?: string;
  providers?: Partial<Record<ProviderId, ProviderConfig>>;
  systemPrompt?: string;
  thinkingCollapsed?: boolean;
  /**
   * Reasoning intensity per model, nested by provider id so entries are
   * unambiguous across providers that share a model name:
   * `{ openrouter: { "openai/gpt-5": "high" } }`. A model absent from the map
   * uses the model's default effort; the explicit sentinel `'off'` disables
   * reasoning for a model that would otherwise default to it.
   */
  reasoningEffortByModel?: Record<
    string,
    Record<string, ReasoningEffort | 'off' | undefined> | undefined
  >;
  /** When true, file-writing tools run without per-call confirmation. */
  autoApplyWrites?: boolean;
  /** When true, finished tool calls render their full input/output inline. */
  expandTools?: boolean;
  /** Tunables for how much context the agent reads and sends. */
  cache?: {
    /** Max lines returned by a single file read before it is paged. */
    maxReadLines?: number;
    /** Max recent messages forwarded to the model per request (older trimmed). */
    maxHistoryMessages?: number;
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
