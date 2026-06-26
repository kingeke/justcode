import { describe, expect, it } from 'vitest';

import {
  ProviderId,
  PROVIDER_BY_ID,
  createCustomProviderEntry,
  customProviderId,
  isCustomProviderId,
  resolveProviderEntry,
} from '@core/ports/provider-catalog';
import type { AppConfig } from '@runtime/config/app-config';

const CUSTOM = {
  name: 'My Corp',
  apiKey: 'sk-secret',
  baseUrl: 'https://llm.my-corp.test/v1',
};

function configWith(custom: Record<string, typeof CUSTOM> = {}): AppConfig {
  return { customProviders: custom } as unknown as AppConfig;
}

describe('customProviderId', () => {
  it('slugifies the name into a namespaced id', () => {
    expect(customProviderId('My Corp')).toBe('custom:my-corp');
    expect(customProviderId('  Acme/LLM!! ')).toBe('custom:acme-llm');
  });

  it('falls back to a stable id when the name has no usable characters', () => {
    expect(customProviderId('***')).toBe('custom:provider');
  });
});

describe('isCustomProviderId', () => {
  it('distinguishes custom ids from built-in ones', () => {
    expect(isCustomProviderId('custom:my-corp')).toBe(true);
    expect(isCustomProviderId(ProviderId.Openai)).toBe(false);
  });
});

describe('createCustomProviderEntry', () => {
  it('builds an OpenAI-compatible client stamped with the custom id', () => {
    const id = customProviderId(CUSTOM.name);
    const entry = createCustomProviderEntry(id, CUSTOM);

    expect(entry.id).toBe(id);
    expect(entry.name).toBe('My Corp');
    expect(entry.apiKeyRequired).toBe(false);

    const client = entry.create(entry.credentialsFromConfig(configWith()));
    expect(client.providerId).toBe(id);
  });

  it('prefers credentials saved in the config over the seed values', () => {
    const id = 'custom:my-corp' as ProviderId;
    const entry = createCustomProviderEntry(id, CUSTOM);

    const credentials = entry.credentialsFromConfig(
      configWith({
        'custom:my-corp': {
          name: 'My Corp',
          apiKey: 'sk-rotated',
          baseUrl: 'https://new.my-corp.test/v1',
        },
      })
    );

    expect(credentials.apiKey).toBe('sk-rotated');
    expect(credentials.baseUrl).toBe('https://new.my-corp.test/v1');
  });
});

describe('resolveProviderEntry', () => {
  it('returns the built-in entry for a known provider id', () => {
    const entry = resolveProviderEntry(configWith(), ProviderId.Openai);
    expect(entry).toBe(PROVIDER_BY_ID[ProviderId.Openai]);
  });

  it('rebuilds a configured custom provider from the config', () => {
    const id = 'custom:my-corp' as ProviderId;
    const entry = resolveProviderEntry(
      configWith({ 'custom:my-corp': CUSTOM }),
      id
    );
    expect(entry?.id).toBe(id);
    expect(entry?.name).toBe('My Corp');
  });

  it('returns undefined for a custom id that is not configured', () => {
    const entry = resolveProviderEntry(
      configWith(),
      'custom:gone' as ProviderId
    );
    expect(entry).toBeUndefined();
  });
});
