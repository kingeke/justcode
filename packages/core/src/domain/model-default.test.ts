import { describe, expect, it } from 'vitest';
import {
  defaultModelForMode,
  defaultModelForSubAgent,
  emptyModelDefaults,
  resolveDefaultModel,
  setModeDefaultModel,
  setSubAgentDefaultModel,
  type ModelReference,
} from '@core/domain/model-default';
import { ProviderId } from '@core/ports/provider-catalog';
import type { ModelInfo } from '@core/ports/chat-model';

const ref = (
  modelId: string,
  providerId = ProviderId.Openai
): ModelReference => ({
  modelId,
  providerId,
});

const model = (id: string, providerId = ProviderId.Openai): ModelInfo => ({
  id,
  displayName: id,
  providerId,
});

describe('model defaults', () => {
  it('sets and reads a mode default without mutating the input', () => {
    const base = emptyModelDefaults();
    const next = setModeDefaultModel('ask', ref('gpt-4.1'), base);
    expect(defaultModelForMode('ask', next)).toEqual(ref('gpt-4.1'));
    // Input untouched.
    expect(defaultModelForMode('ask', base)).toBeUndefined();
  });

  it('clears a mode default when reference is undefined', () => {
    const withDefault = setModeDefaultModel('ask', ref('gpt-4.1'), undefined);
    const cleared = setModeDefaultModel('ask', undefined, withDefault);
    expect(defaultModelForMode('ask', cleared)).toBeUndefined();
  });

  it('sets and reads a sub agent default independently of modes', () => {
    let defaults = setModeDefaultModel('ask', ref('m1'), undefined);
    defaults = setSubAgentDefaultModel('explorer', ref('m2'), defaults);
    expect(defaultModelForSubAgent('explorer', defaults)).toEqual(ref('m2'));
    expect(defaultModelForMode('ask', defaults)).toEqual(ref('m1'));
  });

  it('resolves a default only when the model exists on its provider', () => {
    const available = [model('gpt-4.1'), model('gpt-4.1-mini')];
    expect(resolveDefaultModel(ref('gpt-4.1'), available)?.id).toBe('gpt-4.1');
    // Missing model → undefined (caller falls back to the current model).
    expect(resolveDefaultModel(ref('nope'), available)).toBeUndefined();
    // Right id but wrong provider → undefined.
    expect(
      resolveDefaultModel(ref('gpt-4.1', ProviderId.Anthropic), available)
    ).toBeUndefined();
    expect(resolveDefaultModel(undefined, available)).toBeUndefined();
  });
});
