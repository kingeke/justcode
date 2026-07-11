import { describe, expect, it } from 'vitest';

import { ProviderId } from '@core/ports/provider-catalog';
import { OpenAiResponsesProvider } from '@providers/openai/openai-responses-provider';

function makeProvider(defaultModel?: string): OpenAiResponsesProvider {
  return new OpenAiResponsesProvider({
    baseUrl: 'https://chatgpt.example/backend-api/codex',
    getAccessToken: async () => 'token',
    defaultModel,
  });
}

describe('OpenAiResponsesProvider model catalog', () => {
  it('lists the GPT-5.6 family first, then the previous generation', async () => {
    const models = await makeProvider().listModels();
    expect(models.map((m) => m.id)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
    ]);
    expect(models.every((m) => m.providerId === ProviderId.Openai)).toBe(true);
    expect(models[0]?.displayName).toBe('GPT-5.6 Sol');
  });

  it('defaults to gpt-5.6-sol, honouring a configured override', () => {
    expect(makeProvider().getDefaultModel()).toBe('gpt-5.6-sol');
    expect(makeProvider('gpt-5.4-mini').getDefaultModel()).toBe('gpt-5.4-mini');
  });
});
