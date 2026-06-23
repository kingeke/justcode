import type { ChatMessage, ToolCall } from '@core/domain/message';
import type { ToolDefinition } from '@core/ports/tool';

export enum ProviderId {
  Openai = 'openai',
  Ollama = 'ollama',
  LmStudio = 'lmstudio',
  OpenRouter = 'openrouter',
}

export interface ProviderInfo {
  id: ProviderId;
  name: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  [ProviderId.Openai]: { id: ProviderId.Openai, name: 'OpenAI' },
  [ProviderId.Ollama]: { id: ProviderId.Ollama, name: 'Ollama' },
  [ProviderId.LmStudio]: { id: ProviderId.LmStudio, name: 'LM Studio' },
  [ProviderId.OpenRouter]: { id: ProviderId.OpenRouter, name: 'OpenRouter' },
};

export interface ModelPricing {
  inputPerToken: number;
  outputPerToken: number;
  cacheReadPerToken?: number;
  cacheWritePerToken?: number;
}

export interface ModelInfo {
  id: string;
  displayName: string;
  providerId: ProviderId;
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
  tools?: ToolDefinition[];
  onToken?: (token: string) => void;
  onThinkingToken?: (token: string) => void;
}

export interface ChatResult {
  content: string;
  usage?: TokenUsage;
  /** Tool invocations the model requested instead of (or alongside) a reply. */
  toolCalls?: ToolCall[];
  finishReason?: string;
}

export interface ProviderClient {
  readonly providerId: ProviderId;
  sendChat(request: ChatRequest): Promise<ChatResult>;
  listModels(): Promise<ModelInfo[]>;
  getDefaultModel(): string | undefined;
}
