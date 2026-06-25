import { type ProviderClient } from '@core/ports/chat-model';
import { AlibabaProvider } from '@providers/alibaba/alibaba-provider';
import { LmStudioProvider } from '@providers/lmstudio/lmstudio-provider';
import { OllamaProvider } from '@providers/ollama/ollama-provider';
import { OpenAiProvider } from '@providers/openai/openai-provider';
import { OpenRouterProvider } from '@providers/openrouter/openrouter-provider';
import type { AppConfig } from '@runtime/config/app-config';

export type ProviderCredentialRequirement = 'required' | 'optional' | 'none';

export interface ProviderCatalogEntry {
  id: ProviderId;
  name: string;
  description: string;
  apiKeyRequired: boolean;
  apiKeyEnvVar?: string;
  baseUrl?: string;
  baseUrlEnvVar?: string;
  /** Reads this provider's API key out of the app config. */
  getApiKey: (config: AppConfig) => string | undefined;
  /** Constructs the concrete client for this provider. */
  create: (config: AppConfig) => ProviderClient;
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
    getApiKey: (config) => config.openai.apiKey,
    create: (config) =>
      new OpenAiProvider(
        config.openai.apiKey!,
        config.openai.baseUrl,
        config.openai.defaultModel
      ),
  },
  {
    id: ProviderId.Ollama,
    name: 'Ollama',
    description: 'Local OpenAI-compatible server',
    apiKeyRequired: false,
    apiKeyEnvVar: 'OLLAMA_API_KEY',
    baseUrl: 'http://127.0.0.1:11434',
    baseUrlEnvVar: 'OLLAMA_BASE_URL',
    getApiKey: (config) => config.ollama.apiKey,
    create: (config) =>
      new OllamaProvider(config.ollama.baseUrl, config.ollama.apiKey),
  },
  {
    id: ProviderId.LmStudio,
    name: 'LM Studio',
    description: 'Local OpenAI-compatible server',
    apiKeyRequired: false,
    apiKeyEnvVar: 'LMSTUDIO_API_KEY',
    baseUrl: 'http://127.0.0.1:1234/v1',
    baseUrlEnvVar: 'LMSTUDIO_BASE_URL',
    getApiKey: (config) => config.lmstudio.apiKey,
    create: (config) =>
      new LmStudioProvider(config.lmstudio.baseUrl, config.lmstudio.apiKey),
  },
  {
    id: ProviderId.OpenRouter,
    name: 'OpenRouter',
    description: 'Marketplace models via an OpenAI-compatible API',
    apiKeyRequired: true,
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    baseUrlEnvVar: 'OPENROUTER_BASE_URL',
    getApiKey: (config) => config.openrouter.apiKey,
    create: (config) =>
      new OpenRouterProvider(
        config.openrouter.apiKey!,
        config.openrouter.baseUrl
      ),
  },
  {
    id: ProviderId.Alibaba,
    name: 'Alibaba',
    description: "Qwen via Alibaba Cloud's OpenAI-compatible API",
    apiKeyRequired: true,
    apiKeyEnvVar: 'ALIBABA_API_KEY',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    baseUrlEnvVar: 'ALIBABA_BASE_URL',
    getApiKey: (config) => config.alibaba.apiKey,
    create: (config) =>
      new AlibabaProvider(config.alibaba.apiKey!, config.alibaba.baseUrl),
  },
] as const satisfies readonly ProviderCatalogEntry[];

export type ProviderInfo = Pick<ProviderCatalogEntry, 'id' | 'name'>;

export type ProviderConnectionInfo = ProviderCatalogEntry;

export const PROVIDER_BY_ID: Record<ProviderId, ProviderCatalogEntry> =
  Object.fromEntries(
    PROVIDERS.map((provider) => [provider.id, provider])
  ) as unknown as Record<ProviderId, ProviderCatalogEntry>;
