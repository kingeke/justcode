import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ProviderId } from '@core/ports/chat-model';

export interface AppConfig {
  defaultProvider: ProviderId;
  sessionsDirectory: string;
  openai: {
    apiKey: string | undefined;
    baseUrl: string;
    defaultModel: string;
  };
  ollama: {
    baseUrl: string;
  };
  lmstudio: {
    baseUrl: string;
  };
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const requestedProvider = env.JUSTCODE_PROVIDER;

  return {
    defaultProvider:
      parseProviderId(requestedProvider) ??
      (env.OPENAI_API_KEY ? 'openai' : 'ollama'),
    sessionsDirectory:
      env.JUSTCODE_SESSIONS_DIR ?? join(homedir(), '.justcode', 'sessions'),
    openai: {
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
      defaultModel: env.OPENAI_MODEL ?? 'gpt-4.1-mini',
    },
    ollama: {
      baseUrl: env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
    },
    lmstudio: {
      baseUrl: env.LMSTUDIO_BASE_URL ?? 'http://127.0.0.1:1234/v1',
    },
  };
}

export function parseProviderId(
  value: string | undefined
): ProviderId | undefined {
  if (!value) {
    return undefined;
  }

  if (value === 'openai' || value === 'ollama' || value === 'lmstudio') {
    return value;
  }

  throw new Error(
    `Unsupported provider '${value}'. Expected one of: openai, ollama, lmstudio.`
  );
}
