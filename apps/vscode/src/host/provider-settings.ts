/**
 * Provider management for the Settings tab, kept free of any chat-session state
 * so both the settings panel and the chat bridge can share it. Everything is
 * derived from the saved global config plus the static provider catalog.
 */

import {
  PROVIDERS,
  ProviderId,
  isCustomProviderId,
  CUSTOM_PROVIDER_PREFIX,
  type ProviderCatalogEntry,
} from '@core/ports/provider-catalog';
import {
  readGlobalConfig,
  writeGlobalConfig,
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

  const result: WebviewProvider[] = PROVIDERS.map((entry) => ({
    id: entry.id,
    name: entry.name,
    description: entry.description,
    connected: configured.has(entry.id),
    kind: providerKind(entry),
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
    });
  }

  return result;
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
