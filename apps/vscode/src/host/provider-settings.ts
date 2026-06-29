/**
 * Provider management for the Settings tab, kept free of any chat-session state
 * so both the settings panel and the chat bridge can share it. Everything is
 * derived from the saved global config plus the static provider catalog.
 */

import {
  PROVIDERS,
  PROVIDER_BY_ID,
  ProviderId,
  AuthMethod,
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
import { getOAuthFlow } from '@runtime/auth/oauth-flows';
import type { OAuthLoginContext } from '@runtime/auth/oauth-flow';

import {
  WebviewProviderKind,
  type WebviewProvider,
} from '@ext/shared/protocol';

/** Maps a catalog entry + optional saved config to the badge the webview shows. */
function providerKind(
  entry: ProviderCatalogEntry,
  saved?: ProviderConfig
): WebviewProviderKind {
  if (entry.local) return WebviewProviderKind.Local;
  // For connected providers, show the method they actually used, not what's available.
  if (saved) {
    return saved.authType === AuthMethod.OAuth
      ? WebviewProviderKind.OAuth
      : WebviewProviderKind.ApiKey;
  }
  const methods = entry.authMethods ?? [AuthMethod.ApiKey];
  if (!methods.includes(AuthMethod.ApiKey) && methods.includes(AuthMethod.OAuth)) {
    return WebviewProviderKind.OAuth;
  }
  return WebviewProviderKind.ApiKey;
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
  ).map((entry) => {
    const saved = config.providers?.[entry.id as ProviderId];
    return {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      connected: configured.has(entry.id),
      kind: providerKind(entry, saved),
      apiKeyRequired: entry.apiKeyRequired,
      defaultBaseUrl: entry.baseUrl,
      local: entry.local,
      authMethods: entry.authMethods ?? [AuthMethod.ApiKey],
    };
  });

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
      kind: WebviewProviderKind.Custom,
      apiKeyRequired: false,
      authMethods: [AuthMethod.ApiKey] as AuthMethod[],
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
 * Runs a provider's OAuth sign-in flow entirely inside the extension host: it
 * opens the browser (or shows a device code), captures the redirect/code via the
 * shared runtime flows, validates the minted token with listModels(), and
 * persists the credentials with `authType: 'oauth'`. The interactive parts are
 * driven through {@link context}, which the settings panel wires to the webview
 * (browser open + status/prompt messages). Mirrors the CLI's connect-picker
 * OAuth path so both surfaces produce identical config.
 */
export async function oauthConnectProvider(
  configDir: string,
  providerId: string,
  context: OAuthLoginContext
): Promise<{ success: boolean; error?: string }> {
  const entry = PROVIDER_BY_ID[providerId as ProviderId];
  if (!entry) {
    return { success: false, error: `Unknown provider: ${providerId}` };
  }

  const flow = getOAuthFlow(providerId as ProviderId);
  if (!flow) {
    return {
      success: false,
      error: `OAuth sign-in is not supported for ${entry.name}.`,
    };
  }

  try {
    const oauthCreds = await flow.login(context);
    if (context.signal?.aborted) {
      return { success: false, error: 'Sign-in cancelled.' };
    }

    context.notify('Fetching available models…');
    const client = entry.create({
      baseUrl: oauthCreds.extra?.['endpoint'] ?? entry.baseUrl ?? '',
      oauth: oauthCreds,
      // At connect time return the freshly-minted token directly; the
      // ProviderRegistry wires up the full refresh logic on subsequent starts.
      getAccessToken: async () => oauthCreds.accessToken,
    });

    const models = await client.listModels();
    if (context.signal?.aborted) {
      return { success: false, error: 'Sign-in cancelled.' };
    }
    if (!models.length) {
      return {
        success: false,
        error: `No models are available for ${entry.name}.`,
      };
    }

    const providerConfig: ProviderConfig = {
      authType: AuthMethod.OAuth,
      oauth: oauthCreds,
    };
    const config = await readGlobalConfig(configDir);
    const next = mergeProviderConfig(config, providerId as ProviderId, providerConfig);
    await writeGlobalConfig(configDir, next);

    return { success: true };
  } catch (err) {
    if (context.signal?.aborted) {
      return { success: false, error: 'Sign-in cancelled.' };
    }
    return { success: false, error: describeError(err) };
  }
}

/**
 * Builds a user-facing message from a thrown error. Node's global fetch reports
 * network failures as a bare "fetch failed" and tucks the real reason (DNS,
 * TLS, proxy, refused connection) into `cause` — which the extension host hits
 * far more than the CLI. Walk the cause chain so the surfaced message is
 * actionable instead of opaque.
 */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  const parts: string[] = [err.message];
  let cause: unknown = (err as { cause?: unknown }).cause;
  const seen = new Set<unknown>([err]);
  while (cause instanceof Error && !seen.has(cause)) {
    seen.add(cause);
    const code = (cause as { code?: string }).code;
    parts.push(code ? `${cause.message} (${code})` : cause.message);
    cause = (cause as { cause?: unknown }).cause;
  }

  // Drop duplicate links (fetch often wraps the same text) and join.
  const message = [...new Set(parts)].join(': ');
  return message || 'Sign-in failed.';
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
