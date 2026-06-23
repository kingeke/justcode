import { homedir } from 'node:os';
import { join } from 'node:path';

import { ProviderId } from '@core/ports/chat-model';

export interface AppConfig {
  defaultProvider: ProviderId;
  configDirectory: string;
  sessionsDirectory: string;
  openai: {
    apiKey: string | undefined;
    baseUrl: string;
    defaultModel: string;
  };
  ollama: {
    baseUrl: string;
    apiKey?: string | undefined;
  };
  lmstudio: {
    baseUrl: string;
    apiKey?: string | undefined;
  };
  openrouter: {
    apiKey: string | undefined;
    baseUrl: string;
  };
  alibaba: {
    apiKey: string | undefined;
    baseUrl: string;
  };
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const requestedProvider = env.JUSTCODE_PROVIDER;

  const configDirectory =
    env.JUSTCODE_CONFIG_DIR ?? join(homedir(), '.justcode');
  return {
    defaultProvider:
      parseProviderId(requestedProvider) ??
      (env.OPENAI_API_KEY
        ? ProviderId.Openai
        : env.OPENROUTER_API_KEY
          ? ProviderId.OpenRouter
          : env.ALIBABA_API_KEY
            ? ProviderId.Alibaba
            : ProviderId.Ollama),
    configDirectory,
    sessionsDirectory:
      env.JUSTCODE_SESSIONS_DIR ?? join(configDirectory, 'sessions'),
    openai: {
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
      defaultModel: env.OPENAI_MODEL ?? 'gpt-4.1-mini',
    },
    ollama: {
      baseUrl: env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
      apiKey: env.OLLAMA_API_KEY,
    },
    lmstudio: {
      baseUrl: env.LMSTUDIO_BASE_URL ?? 'http://127.0.0.1:1234/v1',
      apiKey: env.LMSTUDIO_API_KEY,
    },
    openrouter: {
      apiKey: env.OPENROUTER_API_KEY,
      baseUrl: env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    },
    alibaba: {
      apiKey: env.ALIBABA_API_KEY,
      baseUrl:
        env.ALIBABA_BASE_URL ??
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
    },
  };
}

export function parseProviderId(
  value: string | undefined
): ProviderId | undefined {
  if (!value) return undefined;

  const match = Object.values(ProviderId).find((v) => v === value);
  if (match) return match;

  const valid = Object.values(ProviderId).join(', ');
  throw new Error(
    `Unsupported provider '${value}'. Expected one of: ${valid}.`
  );
}
