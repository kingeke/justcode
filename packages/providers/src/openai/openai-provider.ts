import { OpenAiCompatibleProvider } from '@providers/openai-compatible/openai-compatible-provider';

export class OpenAiProvider extends OpenAiCompatibleProvider {
  public constructor(apiKey: string, baseUrl: string, defaultModel: string) {
    super({
      providerId: 'openai',
      apiKey,
      baseUrl,
      defaultModel,
    });
  }
}
