import type { ChatMessage, ToolCall } from '@core/domain/message';
import { ProviderId } from '@core/ports/provider-catalog.js';
import type { ToolDefinition } from '@core/ports/tool';
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

/**
 * Reasoning capability advertised by a provider for a specific model. Only set
 * when the provider's model listing explicitly reports it (e.g. OpenRouter's
 * `supported_parameters` including `reasoning`); absent means "don't offer a
 * reasoning choice for this model".
 */
export interface ModelReasoning {
  /** Effort levels the model accepts, in canonical low→high order. */
  effortLevels: ReasoningEffort[];
  /**
   * True when the model always reasons and the effort cannot be turned off — the
   * picker omits the "off" choice for these and falls back to {@link
   * defaultEffort} when the user hasn't picked a level.
   */
  mandatory: boolean;
  /** The provider's default effort, applied when the user hasn't chosen one. */
  defaultEffort?: ReasoningEffort;
}

export interface ModelInfo {
  id: string;
  displayName: string;
  providerId: ProviderId;
  contextWindow?: number;
  pricing?: ModelPricing;
  /** Present only when the provider reports the model supports reasoning. */
  reasoning?: ModelReasoning;
}

/**
 * Normalized reasoning/thinking intensity, set by the user and translated per
 * provider in `sendChat` (effort enum for OpenAI/OpenRouter, a token budget for
 * Anthropic). Providers and models that don't support reasoning ignore it.
 */
export enum ReasoningEffort {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  /** Some providers (e.g. GitHub Copilot's GPT-5 family) offer a level above high. */
  XHigh = 'xhigh',
}

/**
 * A user's reasoning choice for a request: an effort level, or the explicit
 * sentinel `'off'`. `'off'` differs from "unset": a model that reasons by
 * default must be sent an explicit disable (e.g. OpenRouter's
 * `reasoning: { enabled: false }`) rather than simply omitting the parameter.
 */
export type ReasoningEffortChoice = ReasoningEffort | 'off';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cost?: number;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  onToken?: (token: string) => void;
  onThinkingToken?: (token: string) => void;
  signal?: AbortSignal;
  /**
   * Desired reasoning intensity, or `'off'` to explicitly disable reasoning on a
   * model that would otherwise reason. Ignored by models that don't reason.
   */
  reasoningEffort?: ReasoningEffortChoice;
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
