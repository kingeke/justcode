import type { ChatMessage, ToolCall } from '@core/domain/message';
import type { ToolDefinition } from '@core/ports/tool';

export enum ProviderId {
  Openai = 'openai',
  Ollama = 'ollama',
  LmStudio = 'lmstudio',
  OpenRouter = 'openrouter',
  Alibaba = 'alibaba',
}

export type {
  ProviderConnectionInfo,
  ProviderCredentialRequirement,
  ProviderInfo,
} from './provider-catalog.js';

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
  signal?: AbortSignal;
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

/**
 * Thrown by a provider when a request fails specifically because the target
 * model does not support tool/function calling. The agent loop catches this and
 * retries the model in chat-only mode (no tools).
 */
export class ToolsUnsupportedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ToolsUnsupportedError';
  }
}
