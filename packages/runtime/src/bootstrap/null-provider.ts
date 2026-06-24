import {
  ProviderId,
  type ChatRequest,
  type ChatResult,
  type ModelInfo,
  type ProviderClient,
} from '@core/ports/chat-model';

/**
 * Placeholder provider used before the user has connected anything. It backs
 * the chat session service until a real provider is selected via the connect
 * screen, at which point {@link ChatSessionService.switchProvider} replaces it.
 * Any actual use throws so a misconfigured launch fails loudly rather than
 * silently falling back to a provider the user never chose.
 */
export class NullProvider implements ProviderClient {
  public readonly providerId = ProviderId.Ollama;

  public async sendChat(_request: ChatRequest): Promise<ChatResult> {
    throw new Error('No provider is configured. Connect a provider first.');
  }

  public async listModels(): Promise<ModelInfo[]> {
    return [];
  }

  public getDefaultModel(): string | undefined {
    return undefined;
  }
}
