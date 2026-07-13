import { randomUUID } from 'node:crypto';

import {
  type ChatRequest,
  type ChatResult,
  type ModelInfo,
  type ProviderClient,
} from '@core/ports/chat-model';
import { ProviderId } from '@core/ports/provider-catalog';
import { sendResponsesRequest } from '@providers/openai/openai-responses-client';

interface OpenAiResponsesProviderOptions {
  baseUrl: string;
  /** ChatGPT account id, sent as the `chatgpt-account-id` header. */
  chatgptAccountId?: string | undefined;
  /** Resolves a fresh OAuth access token per request (refreshing on expiry). */
  getAccessToken: () => Promise<string>;
  defaultModel?: string | undefined;
}

/**
 * Models reachable through a ChatGPT subscription via the Codex backend. There
 * is no `/models` listing endpoint for ChatGPT-account tokens (it 403s with
 * `Missing scopes: api.model.read`), so the set is fixed here, mirroring what
 * Codex exposes.
 */
const CODEX_MODELS: ReadonlyArray<{
  id: string;
  displayName: string;
  contextWindow: number;
}> = [
  { id: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', contextWindow: 1_050_000 },
  {
    id: 'gpt-5.6-terra',
    displayName: 'GPT-5.6 Terra',
    contextWindow: 1_050_000,
  },
  { id: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna', contextWindow: 1_050_000 },
  { id: 'gpt-5.5', displayName: 'GPT-5.5', contextWindow: 1_050_000 },
  { id: 'gpt-5.4', displayName: 'GPT-5.4', contextWindow: 1_050_000 },
  { id: 'gpt-5.4-mini', displayName: 'GPT-5.4 mini', contextWindow: 400_000 },
];

// Codex's default power setting runs gpt-5.6-sol (the flagship 5.6 model).
const DEFAULT_CODEX_MODEL = 'gpt-5.6-sol';

/**
 * OpenAI provider backed by the Codex Responses API (ChatGPT subscription
 * sign-in). Unlike {@link OpenAiCompatibleProvider} this speaks the Responses
 * wire format against `${baseUrl}/responses`, attaches the `chatgpt-account-id`
 * header, and lists a fixed model set instead of calling `/models`.
 */
export class OpenAiResponsesProvider implements ProviderClient {
  public readonly providerId = ProviderId.Openai;

  public constructor(
    private readonly options: OpenAiResponsesProviderOptions
  ) {}

  public async listModels(): Promise<ModelInfo[]> {
    return CODEX_MODELS.map((model) => ({
      id: model.id,
      displayName: model.displayName,
      contextWindow: model.contextWindow,
      providerId: this.providerId,
    }));
  }

  public getDefaultModel(): string | undefined {
    return this.options.defaultModel ?? DEFAULT_CODEX_MODEL;
  }

  public async sendChat(request: ChatRequest): Promise<ChatResult> {
    return sendResponsesRequest({
      baseUrl: this.options.baseUrl,
      headers: await this.createHeaders(),
      request,
      providerId: this.providerId,
    });
  }

  private async createHeaders(): Promise<Record<string, string>> {
    return {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      authorization: `Bearer ${await this.options.getAccessToken()}`,
      ...(this.options.chatgptAccountId
        ? { 'chatgpt-account-id': this.options.chatgptAccountId }
        : {}),
      // Codex backend identifies the calling client and threads a session id.
      'openai-beta': 'responses=experimental',
      originator: 'codex_cli_rs',
      session_id: randomUUID(),
    };
  }
}
