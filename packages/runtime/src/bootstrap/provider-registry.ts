import { type ProviderClient } from '@core/ports/chat-model';
import { ProviderId, resolveProviderEntry } from '@core/ports/provider-catalog';
import type { AppConfig } from '@runtime/config/app-config';

export class ProviderRegistry {
  public constructor(private readonly config: AppConfig) {}

  public create(providerId: ProviderId): ProviderClient {
    const entry = resolveProviderEntry(this.config, providerId);
    if (!entry) {
      throw new Error(`Unexpected provider '${String(providerId)}'.`);
    }

    const credentials = entry.credentialsFromConfig(this.config);
    if (entry.apiKeyRequired && !credentials.apiKey) {
      throw new Error(
        `${entry.apiKeyEnvVar ?? 'An API key'} is required when using the ${entry.name} provider.`
      );
    }

    return entry.create(credentials);
  }
}
