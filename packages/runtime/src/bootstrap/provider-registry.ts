import { type ProviderClient } from '@core/ports/chat-model';
import {
  ProviderId,
  AuthMethod,
  resolveProviderEntry,
  type OAuthCredentials,
  type ProviderCredentials,
} from '@core/ports/provider-catalog';
import { withModelsCache } from '@providers/http/models-cache';
import { createTokenProvider } from '@runtime/auth/token-provider';
import type { AppConfig } from '@runtime/config/app-config';
import {
  mergeProviderConfig,
  readGlobalConfig,
  writeGlobalConfig,
} from '@runtime/persistence/global-config';

export class ProviderRegistry {
  public constructor(private readonly config: AppConfig) {}

  public create(providerId: ProviderId): ProviderClient {
    const entry = resolveProviderEntry(this.config, providerId);
    if (!entry) {
      throw new Error(`Unexpected provider '${String(providerId)}'.`);
    }

    const credentials = entry.credentialsFromConfig(this.config);

    // OAuth-connected providers resolve a fresh access token per request and
    // refresh it transparently — they don't carry an API key.
    if (credentials.oauth) {
      credentials.getAccessToken = createTokenProvider(
        providerId,
        credentials.oauth,
        (next) => this.persistOAuth(providerId, next)
      );
    } else if (entry.apiKeyRequired && !credentials.apiKey) {
      throw new Error(
        `${entry.apiKeyEnvVar ?? 'An API key'} is required when using the ${entry.name} provider.`
      );
    }

    // Serve remote providers' model lists from the once-a-day on-disk cache so
    // startup doesn't refetch every provider's catalog. Local providers
    // (Ollama/LM Studio) opt out and always refetch.
    return withModelsCache(entry.create(credentials), {
      local: entry.local ?? false,
    });
  }

  /** Persists refreshed OAuth credentials back into config.json. */
  private async persistOAuth(
    providerId: ProviderId,
    oauth: OAuthCredentials
  ): Promise<void> {
    const stored = await readGlobalConfig(this.config.configDirectory);
    const existing = stored.providers?.[providerId] ?? {};
    const merged = mergeProviderConfig(stored, providerId, {
      ...existing,
      authType: AuthMethod.OAuth,
      oauth,
    });
    await writeGlobalConfig(this.config.configDirectory, merged);
  }
}

// Re-exported only to keep the credentials type handy for callers building
// clients outside the registry (e.g. the connect flow before persistence).
export type { ProviderCredentials };
