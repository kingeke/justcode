import { OpenAiCompatibleProvider } from '@providers/openai-compatible/openai-compatible-provider';

export class LmStudioProvider extends OpenAiCompatibleProvider {
  public constructor(baseUrl: string) {
    super({
      providerId: 'lmstudio',
      baseUrl,
    });
  }
}
