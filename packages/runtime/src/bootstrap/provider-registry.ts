import { ProviderId, type ProviderClient } from '@core/ports/chat-model';
import { LmStudioProvider } from '@providers/lmstudio/lmstudio-provider';
import { OpenAiProvider } from '@providers/openai/openai-provider';
import { OllamaProvider } from '@providers/ollama/ollama-provider';
import { OpenRouterProvider } from '@providers/openrouter/openrouter-provider';
import type { AppConfig } from '@runtime/config/app-config';

export class ProviderRegistry {
  public constructor(private readonly config: AppConfig) {}

  public create(providerId: ProviderId): ProviderClient {
    switch (providerId) {
      case ProviderId.Openai: {
        const { apiKey } = this.config.openai;
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
      case ProviderId.Ollama:
        return new OllamaProvider(
          this.config.ollama.baseUrl,
          this.config.ollama.apiKey
        );
      case ProviderId.LmStudio:
        return new LmStudioProvider(this.config.lmstudio.baseUrl);
      case ProviderId.OpenRouter: {
        const { apiKey } = this.config.openrouter;
        if (!apiKey) {
          throw new Error(
            'OPENROUTER_API_KEY is required when using the OpenRouter provider.'
          );
        }
        return new OpenRouterProvider(apiKey, this.config.openrouter.baseUrl);
      }
      default:
        return assertUnreachable(providerId);
    }
  }
}

function assertUnreachable(value: never): never {
  throw new Error(`Unexpected provider '${String(value)}'.`);
}
