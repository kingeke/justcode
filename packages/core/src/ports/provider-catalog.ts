import { ProviderId } from './chat-model.js';

export type ProviderCredentialRequirement = 'required' | 'optional' | 'none';

export interface ProviderCatalogEntry {
  id: ProviderId;
  name: string;
  description: string;
  apiKeyRequired: boolean;
  apiKeyEnvVar?: string;
  baseUrl?: string;
  baseUrlEnvVar?: string;
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
  },
  {
    id: ProviderId.Ollama,
    name: 'Ollama',
    description: 'Local OpenAI-compatible server',
    apiKeyRequired: false,
    apiKeyEnvVar: 'OLLAMA_API_KEY',
    baseUrl: 'http://127.0.0.1:11434',
    baseUrlEnvVar: 'OLLAMA_BASE_URL',
  },
  {
    id: ProviderId.LmStudio,
    name: 'LM Studio',
    description: 'Local OpenAI-compatible server',
    apiKeyRequired: false,
    apiKeyEnvVar: 'LMSTUDIO_API_KEY',
    baseUrl: 'http://127.0.0.1:1234/v1',
    baseUrlEnvVar: 'LMSTUDIO_BASE_URL',
  },
  {
    id: ProviderId.OpenRouter,
    name: 'OpenRouter',
    description: 'Marketplace models via an OpenAI-compatible API',
    apiKeyRequired: true,
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    baseUrlEnvVar: 'OPENROUTER_BASE_URL',
  },
  {
    id: ProviderId.Alibaba,
    name: 'Alibaba',
    description: "Qwen via Alibaba Cloud's OpenAI-compatible API",
    apiKeyRequired: true,
    apiKeyEnvVar: 'ALIBABA_API_KEY',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    baseUrlEnvVar: 'ALIBABA_BASE_URL',
  },
] as const satisfies readonly ProviderCatalogEntry[];

export type ProviderInfo = Pick<ProviderCatalogEntry, 'id' | 'name'>;

export type ProviderConnectionInfo = ProviderCatalogEntry;

export const PROVIDER_BY_ID: Record<ProviderId, ProviderCatalogEntry> = Object.fromEntries(
  PROVIDERS.map((provider) => [provider.id, provider])
) as Record<ProviderId, ProviderCatalogEntry>;
