import { ProviderId } from '@core/ports/provider-catalog';
import { OpenAiCompatibleProvider } from '@providers/openai-compatible/openai-compatible-provider';

export class OpenAiProvider extends OpenAiCompatibleProvider {
  public constructor(
    apiKey: string,
    baseUrl: string,
    defaultModel: string,
    getAccessToken?: () => Promise<string>
  ) {
    super({
      providerId: ProviderId.Openai,
      apiKey,
      baseUrl,
      defaultModel,
      // The real OpenAI API accepts `prompt_cache_key`; other OpenAI-compatible
      // endpoints may reject unknown params, so it's opt-in per provider.
      supportsPromptCacheKey: true,
      ...(getAccessToken ? { getAccessToken } : {}),
    });
  }
}
