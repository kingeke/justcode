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
      ...(getAccessToken ? { getAccessToken } : {}),
    });
  }
}
