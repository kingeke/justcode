import { ProviderId } from '@core/ports/chat-model';
import { joinUrl } from '@providers/http/http-client';
import { OpenAiCompatibleProvider } from '@providers/openai-compatible/openai-compatible-provider';

/**
 * Ollama exposes an OpenAI-compatible API under `/v1`, so we reuse the shared
 * OpenAI-compatible client (chat completions + models + reasoning deltas) rather
 * than maintaining a separate `/api/*` wire format. The base URL is configured
 * without the `/v1` suffix (e.g. `http://127.0.0.1:11434`), so we append it here.
 */
export class OllamaProvider extends OpenAiCompatibleProvider {
  public constructor(baseUrl: string, apiKey?: string) {
    super({
      providerId: ProviderId.Ollama,
      baseUrl: joinUrl(baseUrl, '/v1'),
      ...(apiKey ? { apiKey } : {}),
    });
  }
}
