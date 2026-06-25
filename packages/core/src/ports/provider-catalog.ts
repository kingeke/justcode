import { type ProviderClient } from '@core/ports/chat-model';
import { AlibabaProvider } from '@providers/alibaba/alibaba-provider';
import { LmStudioProvider } from '@providers/lmstudio/lmstudio-provider';
import { OllamaProvider } from '@providers/ollama/ollama-provider';
import { OpenAiProvider } from '@providers/openai/openai-provider';
import { OpenRouterProvider } from '@providers/openrouter/openrouter-provider';
import type { AppConfig } from '@runtime/config/app-config';

export type ProviderCredentialRequirement = 'required' | 'optional' | 'none';

/** The minimal credentials needed to construct any provider client. */
export interface ProviderCredentials {
  apiKey?: string | undefined;
  baseUrl: string;
  defaultModel?: string | undefined;
}

export interface ProviderCatalogEntry {
  id: ProviderId;
  name: string;
  description: string;
  apiKeyRequired: boolean;
  apiKeyEnvVar?: string;
  baseUrl?: string;
  baseUrlEnvVar?: string;
  /** Extracts this provider's credentials from the saved app config. */
  credentialsFromConfig: (config: AppConfig) => ProviderCredentials;
  /** Constructs the concrete client from a set of credentials. */
  create: (credentials: ProviderCredentials) => ProviderClient;
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
}

export enum ProviderId {
  Openai = 'openai',
  Ollama = 'ollama',
  LmStudio = 'lmstudio',
  OpenRouter = 'openrouter',
  Alibaba = 'alibaba',
}

export const PROVIDERS = [
  {
    id: ProviderId.Openai,
    name: 'OpenAI',
    description: 'Hosted OpenAI models',
    apiKeyRequired: true,
    apiKeyEnvVar: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    baseUrlEnvVar: 'OPENAI_BASE_URL',
    credentialsFromConfig: (config) => ({
      apiKey: config.openai.apiKey,
      baseUrl: config.openai.baseUrl,
      defaultModel: config.openai.defaultModel,
    }),
    create: (credentials) =>
      new OpenAiProvider(
        credentials.apiKey ?? '',
        credentials.baseUrl,
        credentials.defaultModel ?? 'gpt-4.1-mini'
      ),
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
