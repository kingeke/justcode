import { type ProviderClient } from '@core/ports/chat-model';
import { appUserAgent } from '@core/version';
import { AlibabaProvider } from '@providers/alibaba/alibaba-provider';
import { AnthropicProvider } from '@providers/anthropic/anthropic-provider';
import { LmStudioProvider } from '@providers/lmstudio/lmstudio-provider';
import { OllamaProvider } from '@providers/ollama/ollama-provider';
import { OpenAiProvider } from '@providers/openai/openai-provider';
import { OpenAiResponsesProvider } from '@providers/openai/openai-responses-provider';
import { OpenAiCompatibleProvider } from '@providers/openai-compatible/openai-compatible-provider';
import { OpenRouterProvider } from '@providers/openrouter/openrouter-provider';
import type { AppConfig } from '@runtime/config/app-config';

export type ProviderCredentialRequirement = 'required' | 'optional' | 'none';

/**
 * Headers the GitHub Copilot API expects on every request to identify the
 * calling editor/integration. Required — Copilot rejects requests without them.
 */
const COPILOT_HEADERS: Record<string, string> = {
  'Copilot-Integration-Id': 'vscode-chat',
  'Editor-Version': appUserAgent(),
  'Editor-Plugin-Version': appUserAgent(),
};

/** How a provider can be authenticated: a pasted API key, or an OAuth sign-in. */
export type AuthMethod = 'apiKey' | 'oauth';

/**
 * Tokens obtained from an OAuth sign-in (subscription login). Persisted next to
 * the API key in config.json and refreshed in place when {@link expiresAt}
 * passes. {@link extra} carries any provider-specific values that must survive a
 * restart (e.g. the Copilot chat endpoint, or a GitHub token used to re-mint a
 * short-lived Copilot token).
 */
export interface OAuthCredentials {
  accessToken: string;
  refreshToken?: string | undefined;
  /** Epoch milliseconds at which {@link accessToken} expires, if known. */
  expiresAt?: number | undefined;
  extra?: Record<string, string> | undefined;
}

/** The minimal credentials needed to construct any provider client. */
export interface ProviderCredentials {
  apiKey?: string | undefined;
  baseUrl: string;
  defaultModel?: string | undefined;
  /** Present when the provider was connected via OAuth instead of an API key. */
  oauth?: OAuthCredentials | undefined;
  /**
   * Resolves a currently-valid OAuth access token, refreshing and persisting it
   * if it has expired. Supplied by the runtime when building an OAuth-connected
   * client; absent for API-key clients and during the initial connect (where
   * {@link oauth} carries the freshly-obtained token).
   */
  getAccessToken?: (() => Promise<string>) | undefined;
}

export interface ProviderCatalogEntry {
  id: ProviderId;
  name: string;
  description: string;
  apiKeyRequired: boolean;
  apiKeyEnvVar?: string;
  baseUrl?: string;
  baseUrlEnvVar?: string;
  /** Auth methods this provider accepts. Defaults to API key only. */
  authMethods?: AuthMethod[];
  /**
   * True for providers that run on the user's own machine (Ollama, LM Studio).
   * Used to label models as "local" rather than inferring it from the absence
   * of pricing/OAuth, which misclassifies hosted API-key providers.
   */
  local?: boolean;
  /** Extracts this provider's credentials from the saved app config. */
  credentialsFromConfig: (config: AppConfig) => ProviderCredentials;
  /** Constructs the concrete client from a set of credentials. */
  create: (credentials: ProviderCredentials) => ProviderClient;
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  /** Display name — persisted only for custom (user-added) providers. */
  name?: string;
  /** How this provider was connected. Defaults to 'apiKey' when absent. */
  authType?: AuthMethod;
  /** OAuth tokens, present when {@link authType} is 'oauth'. */
  oauth?: OAuthCredentials;
}

export enum ProviderId {
  Openai = 'openai',
  Anthropic = 'anthropic',
  Copilot = 'copilot',
  Ollama = 'ollama',
  LmStudio = 'lmstudio',
  OpenRouter = 'openrouter',
  Alibaba = 'alibaba',
}

export const PROVIDERS = [
  {
    id: ProviderId.Openai,
    name: 'OpenAI',
    description: 'Hosted OpenAI models (API key or ChatGPT sign-in)',
    apiKeyRequired: true,
    apiKeyEnvVar: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    baseUrlEnvVar: 'OPENAI_BASE_URL',
    authMethods: ['apiKey', 'oauth'],
    credentialsFromConfig: (config) => ({
      apiKey: config.openai.apiKey,
      // ChatGPT sign-in routes to the Codex backend (stored in oauth.extra);
      // API-key auth uses the standard platform base URL.
      baseUrl: config.openai.oauth?.extra?.endpoint ?? config.openai.baseUrl,
      defaultModel: config.openai.defaultModel,
      oauth: config.openai.oauth,
    }),
    create: (credentials) => {
      // ChatGPT-subscription tokens can't use the platform API — they only work
      // against the Codex Responses API. Pick the provider by auth method.
      if (credentials.oauth && credentials.getAccessToken) {
        return new OpenAiResponsesProvider({
          baseUrl: credentials.baseUrl,
          chatgptAccountId: credentials.oauth.extra?.chatgptAccountId,
          getAccessToken: credentials.getAccessToken,
          defaultModel: credentials.defaultModel,
        });
      }
      return new OpenAiProvider(
        credentials.apiKey ?? '',
        credentials.baseUrl,
        credentials.defaultModel ?? 'gpt-4.1-mini'
      );
    },
  },
  {
    id: ProviderId.Anthropic,
    name: 'Anthropic',
    description: 'Claude models (API key)',
    apiKeyRequired: true,
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    baseUrl: 'https://api.anthropic.com',
    baseUrlEnvVar: 'ANTHROPIC_BASE_URL',
    // Subscription (Pro/Max) OAuth is intentionally disabled: as of Jan 2026
    // Anthropic rejects Claude subscription OAuth tokens used outside the
    // official Claude Code client ("This credential is only authorized for use
    // with Claude Code") and may restrict the account. The OAuth flow code is
    // kept in @runtime/auth/anthropic-oauth in case the policy changes; to
    // re-enable, restore 'oauth' here.
    authMethods: ['apiKey'],
    credentialsFromConfig: (config) => ({
      apiKey: config.anthropic.apiKey,
      baseUrl: config.anthropic.baseUrl,
      oauth: config.anthropic.oauth,
    }),
    create: (credentials) =>
      new AnthropicProvider({
        baseUrl: credentials.baseUrl,
        ...(credentials.apiKey ? { apiKey: credentials.apiKey } : {}),
        ...(credentials.getAccessToken
          ? { getAccessToken: credentials.getAccessToken }
          : {}),
      }),
  },
  {
    id: ProviderId.Copilot,
    name: 'GitHub Copilot',
    description: 'Models via a GitHub Copilot subscription (sign-in)',
    apiKeyRequired: false,
    baseUrl: 'https://api.githubcopilot.com',
    authMethods: ['oauth'],
    credentialsFromConfig: (config) => ({
      baseUrl: config.copilot.oauth?.extra?.endpoint ?? config.copilot.baseUrl,
      oauth: config.copilot.oauth,
    }),
    create: (credentials) =>
      new OpenAiCompatibleProvider({
        providerId: ProviderId.Copilot,
        baseUrl: credentials.baseUrl,
        ...(credentials.getAccessToken
          ? { getAccessToken: credentials.getAccessToken }
          : {}),
        extraHeaders: COPILOT_HEADERS,
      }),
  },
  {
    id: ProviderId.OpenRouter,
    name: 'OpenRouter',
    description: 'Marketplace models via an OpenAI-compatible API',
    apiKeyRequired: true,
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    baseUrlEnvVar: 'OPENROUTER_BASE_URL',
    credentialsFromConfig: (config) => ({
      apiKey: config.openrouter.apiKey,
      baseUrl: config.openrouter.baseUrl,
    }),
    create: (credentials) =>
      new OpenRouterProvider(credentials.apiKey ?? '', credentials.baseUrl),
  },
  {
    id: ProviderId.Alibaba,
    name: 'Alibaba',
    description: "Qwen via Alibaba Cloud's OpenAI-compatible API",
    apiKeyRequired: true,
    apiKeyEnvVar: 'ALIBABA_API_KEY',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    baseUrlEnvVar: 'ALIBABA_BASE_URL',
    credentialsFromConfig: (config) => ({
      apiKey: config.alibaba.apiKey,
      baseUrl: config.alibaba.baseUrl,
    }),
    create: (credentials) =>
      new AlibabaProvider(credentials.apiKey ?? '', credentials.baseUrl),
  },
  {
    id: ProviderId.Ollama,
    name: 'Ollama',
    description: 'Local OpenAI-compatible server',
    local: true,
    apiKeyRequired: false,
    apiKeyEnvVar: 'OLLAMA_API_KEY',
    baseUrl: 'http://127.0.0.1:11434',
    baseUrlEnvVar: 'OLLAMA_BASE_URL',
    credentialsFromConfig: (config) => ({
      apiKey: config.ollama.apiKey,
      baseUrl: config.ollama.baseUrl,
    }),
    create: (credentials) =>
      new OllamaProvider(credentials.baseUrl, credentials.apiKey),
  },
  {
    id: ProviderId.LmStudio,
    name: 'LM Studio',
    description: 'Local OpenAI-compatible server',
    local: true,
    apiKeyRequired: false,
    apiKeyEnvVar: 'LMSTUDIO_API_KEY',
    baseUrl: 'http://127.0.0.1:1234/v1',
    baseUrlEnvVar: 'LMSTUDIO_BASE_URL',
    credentialsFromConfig: (config) => ({
      apiKey: config.lmstudio.apiKey,
      baseUrl: config.lmstudio.baseUrl,
    }),
    create: (credentials) =>
      new LmStudioProvider(credentials.baseUrl, credentials.apiKey),
  },
] as const satisfies readonly ProviderCatalogEntry[];

export type ProviderInfo = Pick<ProviderCatalogEntry, 'id' | 'name'>;

export type ProviderConnectionInfo = ProviderCatalogEntry;

export const PROVIDER_BY_ID: Record<ProviderId, ProviderCatalogEntry> =
  Object.fromEntries(
    PROVIDERS.map((provider) => [provider.id, provider])
  ) as unknown as Record<ProviderId, ProviderCatalogEntry>;

/** Canonical display order for providers, taken straight from the catalog. */
export const PROVIDER_IDS: ProviderId[] = PROVIDERS.map(
  (provider) => provider.id
);

/**
 * Custom (user-added) providers are namespaced with this prefix so their ids
 * never collide with the built-in {@link ProviderId} values and can be told
 * apart from them anywhere a provider id is handled as a plain string.
 */
export const CUSTOM_PROVIDER_PREFIX = 'custom:';

/** The resolved shape of a custom provider — name and base URL are required. */
export interface CustomProviderConfig {
  name: string;
  apiKey?: string | undefined;
  baseUrl: string;
  defaultModel?: string | undefined;
}

export function isCustomProviderId(id: string): boolean {
  return id.startsWith(CUSTOM_PROVIDER_PREFIX);
}

/** Derives a stable, namespaced id from a custom provider's display name. */
export function customProviderId(name: string): ProviderId {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${CUSTOM_PROVIDER_PREFIX}${slug || 'provider'}` as ProviderId;
}

/**
 * Builds a catalog entry for a custom, OpenAI-compatible provider. Custom
 * providers behave like any built-in entry: they can be listed, connected, and
 * reconstructed from the saved config — they just aren't known at compile time.
 */
export function createCustomProviderEntry(
  id: ProviderId,
  custom: CustomProviderConfig
): ProviderCatalogEntry {
  return {
    id,
    name: custom.name,
    description: 'Custom OpenAI-compatible provider',
    apiKeyRequired: false,
    baseUrl: custom.baseUrl,
    credentialsFromConfig: (config) => {
      const saved = config.customProviders[id];
      return {
        apiKey: saved?.apiKey ?? custom.apiKey,
        baseUrl: saved?.baseUrl ?? custom.baseUrl,
        defaultModel: saved?.defaultModel ?? custom.defaultModel,
      };
    },
    create: (credentials) =>
      new OpenAiCompatibleProvider({
        providerId: id,
        baseUrl: credentials.baseUrl,
        ...(credentials.apiKey ? { apiKey: credentials.apiKey } : {}),
        ...(credentials.defaultModel
          ? { defaultModel: credentials.defaultModel }
          : {}),
      }),
  };
}

/**
 * Resolves the catalog entry for any provider id — a built-in from the static
 * catalog, or a custom one rebuilt from the saved config. Returns undefined when
 * the id is unknown (e.g. a custom provider that is no longer configured).
 */
export function resolveProviderEntry(
  config: AppConfig,
  id: ProviderId
): ProviderCatalogEntry | undefined {
  if (isCustomProviderId(id)) {
    const custom = config.customProviders[id];
    return custom ? createCustomProviderEntry(id, custom) : undefined;
  }
  return PROVIDER_BY_ID[id];
}
