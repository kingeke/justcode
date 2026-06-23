import { ProviderId } from '@core/ports/chat-model';
import { OpenAiCompatibleProvider } from '@providers/openai-compatible/openai-compatible-provider';

export class AlibabaProvider extends OpenAiCompatibleProvider {
  public constructor(apiKey: string, baseUrl?: string) {
    super({
      providerId: ProviderId.Alibaba,
      apiKey,
      baseUrl: baseUrl ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });
  }
}
