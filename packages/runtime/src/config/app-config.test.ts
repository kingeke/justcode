import { describe, expect, it } from 'vitest';

import { loadAppConfig, parseProviderId } from '@runtime/config/app-config';

describe('loadAppConfig', () => {
  it('defaults to Ollama when no explicit provider or OpenAI key exists', () => {
    const config = loadAppConfig({});

    expect(config.defaultProvider).toBe('ollama');
    expect(config.ollama.baseUrl).toBe('http://127.0.0.1:11434');
  });

  it('defaults to OpenAI when an API key is present', () => {
    const config = loadAppConfig({ OPENAI_API_KEY: 'test-key' });

    expect(config.defaultProvider).toBe('openai');
    expect(config.openai.apiKey).toBe('test-key');
    expect(config.openai.defaultModel).toBe('gpt-4.1-mini');
  });

  it('honors explicit provider overrides', () => {
    const config = loadAppConfig({ JUSTCODE_PROVIDER: 'lmstudio' });

    expect(config.defaultProvider).toBe('lmstudio');
    expect(config.lmstudio.baseUrl).toBe('http://127.0.0.1:1234/v1');
  });

  it('defaults to Alibaba when its API key is present', () => {
    const config = loadAppConfig({ ALIBABA_API_KEY: 'test-key' });

    expect(config.defaultProvider).toBe('alibaba');
    expect(config.alibaba.apiKey).toBe('test-key');
    expect(config.alibaba.baseUrl).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1'
    );
  });
});

describe('parseProviderId', () => {
  it('throws for unknown providers', () => {
    expect(() => parseProviderId('anthropic')).toThrow(
      "Unsupported provider 'anthropic'."
    );
  });
});
