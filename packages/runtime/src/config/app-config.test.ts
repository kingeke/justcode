import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';

import { loadAppConfig, parseProviderId } from '@runtime/config/app-config';
import { join } from 'node:path';
import {
  ASK_SYSTEM_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  PLAN_SYSTEM_PROMPT,
} from '@core/application/system-prompt';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  chmod: vi.fn(),
}));

describe('loadAppConfig', () => {
  const mockConfigDir = '/mock/config';

  beforeEach(() => {
    vi.mocked(mkdir).mockReset();
    vi.mocked(readFile).mockReset();
    vi.mocked(writeFile).mockReset();
    vi.mocked(chmod).mockReset();
  });

  it('has no default provider when nothing is configured', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({}));

    const config = await loadAppConfig(mockConfigDir);

    expect(config.defaultProvider).toBeUndefined();
    expect(config.configuredProviders).toEqual([]);
    expect(config.ollama.baseUrl).toBe('http://127.0.0.1:11434');
    expect(config.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
    // config.json is written owner-only via writeSecureFile.
    expect(writeFile).toHaveBeenCalledWith(
      join(mockConfigDir, 'config.json'),
      expect.stringContaining('systemPrompt'),
      expect.objectContaining({ encoding: 'utf8' })
    );
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

  it('surfaces user-added custom providers', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        lastProvider: 'custom:my-corp',
        providers: {
          'custom:my-corp': {
            name: 'My Corp',
            apiKey: 'sk-secret',
            baseUrl: 'https://llm.my-corp.test/v1',
          },
        },
      })
    );

    const config = await loadAppConfig(mockConfigDir);

    expect(config.defaultProvider).toBe('custom:my-corp');
    expect(config.configuredProviders).toContain('custom:my-corp');
    expect(config.customProviders['custom:my-corp']).toEqual({
      name: 'My Corp',
      apiKey: 'sk-secret',
      baseUrl: 'https://llm.my-corp.test/v1',
      defaultModel: undefined,
    });
  });

  it('uses custom config directory', async () => {
    const customDir = '/custom/dir';
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({}));

    await loadAppConfig(customDir);

    expect(readFile).toHaveBeenCalledWith(
      join(customDir, 'config.json'),
      'utf8'
    );
  });

  it('preserves explicitly empty mode prompts without rewriting', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        systemPrompt: '',
        askSystemPrompt: '',
        planSystemPrompt: '',
      })
    );

    const config = await loadAppConfig(mockConfigDir);

    expect(config.systemPrompt).toBe('');
    expect(config.askSystemPrompt).toBe('');
    expect(config.planSystemPrompt).toBe('');
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('defaults and persists the Ask and Plan prompts when missing', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ systemPrompt: 'my custom build prompt' })
    );

    const config = await loadAppConfig(mockConfigDir);

    // The explicit Build prompt is kept; Ask/Plan are filled from the defaults.
    expect(config.systemPrompt).toBe('my custom build prompt');
    expect(config.askSystemPrompt).toBe(ASK_SYSTEM_PROMPT);
    expect(config.planSystemPrompt).toBe(PLAN_SYSTEM_PROMPT);
    // Missing prompts are written back so they show up in config.json.
    expect(writeFile).toHaveBeenCalledWith(
      join(mockConfigDir, 'config.json'),
      expect.stringContaining('askSystemPrompt'),
      expect.objectContaining({ encoding: 'utf8' })
    );
  });
});

describe('parseProviderId', () => {
  it('throws for unknown providers', () => {
    expect(() => parseProviderId('notaprovider')).toThrow(
      "Unsupported provider 'notaprovider'."
    );
  });

  it('accepts namespaced custom provider ids', () => {
    expect(parseProviderId('custom:my-corp')).toBe('custom:my-corp');
  });
});
