import type { ChatMessage } from '@core/domain/message';

export type ProviderId = 'openai' | 'ollama' | 'lmstudio' | 'openrouter';

export interface ModelInfo {
  id: string;
  displayName: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  onToken?: (token: string) => void;
}

export interface ChatResult {
  content: string;
}

export interface ProviderClient {
  readonly providerId: ProviderId;
  sendChat(request: ChatRequest): Promise<ChatResult>;
  listModels(): Promise<ModelInfo[]>;
  getDefaultModel(): string | undefined;
}

export interface OpenRouterProviderClient {
  sendChat(request: ChatRequest): Promise<ChatResult>;
  listModels(): Promise<ModelInfo[]>;
}
