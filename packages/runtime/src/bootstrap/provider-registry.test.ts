import { describe, expect, it } from 'vitest';

import { ProviderId } from '@core/ports/provider-catalog';
import { ProviderRegistry } from '@runtime/bootstrap/provider-registry';
import type { AppConfig } from '@runtime/config/app-config';

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    defaultProvider: undefined,
    configuredProviders: [],
    configDirectory: '/tmp/justcode',
    sessionsDirectory: '/tmp/justcode/sessions',
    systemPrompt: '',
    openai: {
      apiKey: undefined,
      baseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4.1-mini',
      oauth: undefined,
    },
    anthropic: {
      apiKey: undefined,
      baseUrl: 'https://api.anthropic.com',
      oauth: undefined,
    },
    copilot: {
      baseUrl: 'https://api.githubcopilot.com',
      oauth: undefined,
    },
    ollama: { baseUrl: 'http://127.0.0.1:11434' },
    lmstudio: { baseUrl: 'http://127.0.0.1:1234/v1' },
    openrouter: { apiKey: undefined, baseUrl: 'https://openrouter.ai/api/v1' },
    alibaba: {
      apiKey: undefined,
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    },
    customProviders: {},
    ...overrides,
  };
}

describe('ProviderRegistry', () => {
  it('creates a configured custom provider client', () => {
    const registry = new ProviderRegistry(
      baseConfig({
        customProviders: {
          'custom:my-corp': {
            name: 'My Corp',
            apiKey: 'sk-secret',
            baseUrl: 'https://llm.my-corp.test/v1',
          },
        },
      })
    );

    const client = registry.create('custom:my-corp' as ProviderId);
    expect(client.providerId).toBe('custom:my-corp');
  });

  it('throws for a custom provider that is not configured', () => {
    const registry = new ProviderRegistry(baseConfig());
    expect(() => registry.create('custom:missing' as ProviderId)).toThrow();
  });
});
