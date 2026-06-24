import { describe, expect, it, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';

import { loadAppConfig, parseProviderId } from '@runtime/config/app-config';
import { join } from 'node:path';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

describe('loadAppConfig', () => {
  const mockConfigDir = '/mock/config';

  it('has no default provider when nothing is configured', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({}));

    const config = await loadAppConfig(mockConfigDir);

    expect(config.defaultProvider).toBeUndefined();
    expect(config.configuredProviders).toEqual([]);
    expect(config.ollama.baseUrl).toBe('http://127.0.0.1:11434');
  });

  it('defaults to OpenAI when an API key is present', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        providers: {
          openai: {
            apiKey: 'test-key',
            baseUrl: 'https://custom.openai.com/v1',
            defaultModel: 'gpt-4',
          },
        },
      })
    );

    const config = await loadAppConfig(mockConfigDir);

    expect(config.defaultProvider).toBe('openai');
    expect(config.openai.apiKey).toBe('test-key');
    expect(config.openai.baseUrl).toBe('https://custom.openai.com/v1');
    expect(config.openai.defaultModel).toBe('gpt-4');
  });

  it('honors explicit provider in config', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        lastProvider: 'lmstudio',
        providers: {
          lmstudio: {
            baseUrl: 'http://custom:1234/v1',
          },
        },
      })
    );

    const config = await loadAppConfig(mockConfigDir);

    expect(config.defaultProvider).toBe('lmstudio');
    expect(config.lmstudio.baseUrl).toBe('http://custom:1234/v1');
  });

  it('defaults to Alibaba when its API key is present', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        providers: {
          alibaba: {
            apiKey: 'test-key',
          },
        },
      })
    );

    const config = await loadAppConfig(mockConfigDir);

    expect(config.defaultProvider).toBe('alibaba');
    expect(config.alibaba.apiKey).toBe('test-key');
    expect(config.alibaba.baseUrl).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1'
    );
  });

  it('uses custom config directory', async () => {
    const customDir = '/custom/dir';
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({}));

    await loadAppConfig(customDir);

    expect(readFile).toHaveBeenCalledWith(join(customDir, 'config.json'), 'utf8');
  });
});

describe('parseProviderId', () => {
  it('throws for unknown providers', () => {
    expect(() => parseProviderId('anthropic')).toThrow(
      "Unsupported provider 'anthropic'."
    );
  });
});
