import type { ChatMessage } from '@core/domain/message';

export enum ProviderId {
  Openai = 'openai',
  Ollama = 'ollama',
  LmStudio = 'lmstudio',
  OpenRouter = 'openrouter',
}

export interface ModelPricing {
  inputPerToken: number;
  outputPerToken: number;
  cacheReadPerToken?: number;
}

export interface ModelInfo {
  id: string;
  displayName: string;
  contextWindow?: number;
  pricing?: ModelPricing;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  onToken?: (token: string) => void;
}

export interface ChatResult {
  content: string;
  usage?: TokenUsage;
}

export interface ProviderClient {
  readonly providerId: ProviderId;
  sendChat(request: ChatRequest): Promise<ChatResult>;
  listModels(): Promise<ModelInfo[]>;
  getDefaultModel(): string | undefined;
}

