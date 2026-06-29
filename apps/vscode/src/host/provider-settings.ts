/**
 * Provider management for the Settings tab, kept free of any chat-session state
 * so both the settings panel and the chat bridge can share it. Everything is
 * derived from the saved global config plus the static provider catalog.
 */

import {
  PROVIDERS,
  PROVIDER_BY_ID,
  ProviderId,
  isCustomProviderId,
  CUSTOM_PROVIDER_PREFIX,
  type ProviderCatalogEntry,
  type ProviderConfig,
} from '@core/ports/provider-catalog';
import {
  readGlobalConfig,
  writeGlobalConfig,
  mergeProviderConfig,
} from '@runtime/persistence/global-config';

import type {
  WebviewProvider,
  WebviewProviderKind,
} from '@ext/shared/protocol';

/** Maps a catalog entry's auth method to the badge kind the webview renders. */
function providerKind(entry: ProviderCatalogEntry): WebviewProviderKind {
  if (entry.local) return 'local';
  const methods = entry.authMethods ?? ['apiKey'];
  if (!methods.includes('apiKey') && methods.includes('oauth')) return 'oauth';
  return 'apiKey';
}

/**
 * Builds the settings provider list from the saved config and the static
 * catalog: every built-in provider (flagged connected when credentials exist)
 * plus any custom providers the user has added.
 */
export async function listProviders(
  configDir: string
): Promise<WebviewProvider[]> {
  const config = await readGlobalConfig(configDir);
  const configured = new Set(Object.keys(config.providers ?? {}));

  const result: WebviewProvider[] = (
    PROVIDERS as readonly ProviderCatalogEntry[]
  ).map((entry) => ({
    id: entry.id,
    name: entry.name,
    description: entry.description,
    connected: configured.has(entry.id),
    kind: providerKind(entry),
    apiKeyRequired: entry.apiKeyRequired,
    defaultBaseUrl: entry.baseUrl,
    local: entry.local,
    authMethods: (entry.authMethods ?? ['apiKey']) as ('apiKey' | 'oauth')[],
  }));

  // Custom (user-added) providers aren't in the static catalog; surface each as
  // a connected entry so the user can see and disconnect it.
  for (const id of configured) {
    if (!isCustomProviderId(id)) continue;
    const saved = config.providers?.[id as ProviderId];
    result.push({
      id,
      name: saved?.name ?? id.slice(CUSTOM_PROVIDER_PREFIX.length),
      description: 'Custom OpenAI-compatible provider',
      connected: true,
      kind: 'custom',
      apiKeyRequired: false,
      authMethods: ['apiKey'],
    });
  }

  return result;
}

/**
 * Validates credentials by instantiating the provider client and calling
 * listModels(). If the call succeeds, persists the credentials to config and
 * returns { success: true }. On any failure returns { success: false, error }.
 *
 * Mirrors the CLI's connect flow: api-key → base-url → connecting step.
 */
export async function testAndConnectProvider(
  configDir: string,
  providerId: string,
  apiKey?: string,
  baseUrl?: string
): Promise<{ success: boolean; error?: string }> {
  const entry = PROVIDER_BY_ID[providerId as ProviderId];
  if (!entry) {
    return { success: false, error: `Unknown provider: ${providerId}` };
  }

  const resolvedBaseUrl = baseUrl?.trim() || entry.baseUrl || '';

  try {
    const client = entry.create({
      apiKey: apiKey?.trim() || undefined,
      baseUrl: resolvedBaseUrl,
    });

    const models = await client.listModels();
    if (!models.length) {
      return {
        success: false,
        error: `No models are available for ${entry.name}.`,
      };
    }

    // Persist using the same logic as the CLI: only save fields the provider
    // actually has env-var slots for, so we don't pollute the config.
    const providerConfig: ProviderConfig = {};
    if (apiKey?.trim() && entry.apiKeyEnvVar) {
      providerConfig.apiKey = apiKey.trim();
    }
    if (entry.baseUrlEnvVar) {
      providerConfig.baseUrl = resolvedBaseUrl;
    }

    const config = await readGlobalConfig(configDir);
    const next = mergeProviderConfig(config, providerId as ProviderId, providerConfig);
    await writeGlobalConfig(configDir, next);

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Removes a provider's saved credentials. Returns true when something was
 * actually removed, so callers can decide whether to invalidate live state.
 */
export async function disconnectProvider(
  configDir: string,
  providerId: string
): Promise<boolean> {
  const config = await readGlobalConfig(configDir);
  const providers = { ...(config.providers ?? {}) };
  if (!(providerId in providers)) return false;

  delete providers[providerId as ProviderId];
  const next = { ...config, providers };
  // Drop the remembered selection if it pointed at the removed provider, so the
  // next session falls back to another configured provider (or the connect
  // screen) rather than a provider with no credentials.
  if (next.lastProvider === providerId) {
    delete next.lastProvider;
    delete next.lastModel;
  }
  await writeGlobalConfig(configDir, next);
  return true;
}
