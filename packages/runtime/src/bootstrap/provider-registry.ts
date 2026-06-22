import type { ProviderClient, ProviderId } from '@core/ports/chat-model';
import { LmStudioProvider } from '@providers/lmstudio/lmstudio-provider';
import { OpenAiProvider } from '@providers/openai/openai-provider';
import { OllamaProvider } from '@providers/ollama/ollama-provider';
import type { AppConfig } from '@runtime/config/app-config';

export class ProviderRegistry {
  public constructor(private readonly config: AppConfig) {}

  public create(providerId: ProviderId): ProviderClient {
    switch (providerId) {
      case 'openai': {
        const apiKey = this.config.openai.apiKey;

        if (!apiKey) {
          throw new Error(
            'OPENAI_API_KEY is required when using the OpenAI provider.'
          );
        }

        return new OpenAiProvider(
          apiKey,
          this.config.openai.baseUrl,
          this.config.openai.defaultModel
        );
      }
      case 'ollama':
        return new OllamaProvider(this.config.ollama.baseUrl);
      case 'lmstudio':
        return new LmStudioProvider(this.config.lmstudio.baseUrl);
      default:
        return assertUnreachable(providerId);
    }
  }
}

function assertUnreachable(value: string): never {
  throw new Error(`Unexpected provider '${value}'.`);
}
