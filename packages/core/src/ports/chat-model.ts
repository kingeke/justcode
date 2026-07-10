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
  /** Some providers (e.g. GitHub Copilot's GPT-5 family) offer levels above high. */
  XHigh = 'xhigh',
  Max = 'max',
}

/**
 * A user's reasoning choice for a request: an effort level, or the explicit
 * sentinel `'off'`. `'off'` differs from "unset": a model that reasons by
 * default must be sent an explicit disable (e.g. OpenRouter's
 * `reasoning: { enabled: false }`) rather than simply omitting the parameter.
 */
export enum ReasoningDisabled {
  Off = 'off',
}

export type ReasoningEffortChoice = ReasoningEffort | ReasoningDisabled.Off;

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
  /**
   * The chat session this request belongs to. Providers that support it (e.g.
   * OpenRouter's `session_id`) use it to group the session's requests in their
   * dashboard and as a sticky routing key, so every request in the session hits
   * the same upstream provider and its prompt cache. Others ignore it.
   */
  sessionId?: string;
  /**
   * True for out-of-band utility calls (e.g. session title generation) whose
   * messages are not part of the session's conversation. Stateless providers
   * ignore this; session-oriented providers (Claude Code) must run these as
   * throwaway one-shots instead of feeding them into the persistent session —
   * otherwise the utility prompt would poison the conversation's context.
   */
  ephemeral?: boolean;
}

export interface ChatResult {
  content: string;
  usage?: TokenUsage;
  /** Tool invocations the model requested instead of (or alongside) a reply. */
  toolCalls?: ToolCall[];
  finishReason?: string;
}

/** One plan rate-limit window in a {@link ProviderUsageSummary}. */
export interface ProviderUsageWindow {
  /** Human label, e.g. "5-hour" or "7-day". */
  label: string;
  /** Percent of the window used, 0–100; undefined when the API omitted it. */
  utilization?: number | undefined;
  /** ISO timestamp when the window resets, when known. */
  resetsAt?: string | undefined;
}

/**
 * Subscription/plan usage as reported by the provider (Claude Code's /usage
 * data). Only providers with an account-level usage surface implement it.
 */
export interface ProviderUsageSummary {
  /** Plan name, e.g. 'pro' | 'max', when the provider reports one. */
  plan?: string | undefined;
  windows: ProviderUsageWindow[];
  /** API-equivalent cost accumulated by the current session, in USD. */
  sessionCostUsd?: number | undefined;
}

export interface ProviderClient {
  readonly providerId: ProviderId;
  /**
   * True for providers that hold a persistent model session whose advertised
   * tool set cannot change mid-turn (Claude Code: the runtime's in-flight turn
   * doesn't re-list MCP tools). The engine then advertises the full toolset
   * from the first request instead of lazy-loading tools through the gateway —
   * cheap for these providers, since their session prompt (tool schemas
   * included) is cached across the conversation.
   */
  readonly requiresStableToolset?: boolean | undefined;
  sendChat(request: ChatRequest): Promise<ChatResult>;
  listModels(): Promise<ModelInfo[]>;
  getDefaultModel(): string | undefined;
  /**
   * Tears down any per-session state held for `sessionId`. Optional: only
   * session-oriented providers (Claude Code, which spawns a runtime process per
   * session) need it; stateless HTTP providers hold nothing. Callers that mint
   * throwaway session ids (sub agent runs) invoke it when the run ends so those
   * sessions don't accumulate.
   */
  closeSession?: ((sessionId: string) => void) | undefined;
  /**
   * Plan usage for a `/usage`-style display. Optional: only providers with an
   * account-level usage surface (Claude Code) implement it; absent means the
   * command isn't supported for this provider.
   */
  getUsageSummary?:
    | ((sessionId?: string) => Promise<ProviderUsageSummary>)
    | undefined;
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
