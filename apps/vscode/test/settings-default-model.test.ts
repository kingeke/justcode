import { describe, expect, it, vi } from 'vitest';

// settings-panel pulls in the extension host API at import time; the routing
// helper under test touches none of it, so a bare stand-in suffices.
vi.mock('vscode', () => ({
  Uri: { file: (path: string) => ({ path }) },
  ViewColumn: { One: 1 },
  window: {},
  workspace: {},
  commands: {},
}));

const { applyPromptDefaultModel, toModelReference } =
  await import('@ext/host/settings-panel');
const { ProviderId } = await import('@core/ports/provider-catalog');

describe('applyPromptDefaultModel', () => {
  const reference = { providerId: ProviderId.Openai, modelId: 'gpt-4.1' };

  it('binds a mode id under byMode', () => {
    const defaults = applyPromptDefaultModel(undefined, 'plan', reference);
    expect(defaults.byMode['plan']).toEqual(reference);
    expect(defaults.bySubAgent).toEqual({});
  });

  it('binds a `subagent-<id>` prompt id under bySubAgent, stripped', () => {
    const defaults = applyPromptDefaultModel(
      undefined,
      'subagent-explorer',
      reference
    );
    expect(defaults.bySubAgent['explorer']).toEqual(reference);
    expect(defaults.byMode).toEqual({});
  });

  it('clears a binding when the reference is undefined', () => {
    const bound = applyPromptDefaultModel(undefined, 'ask', reference);
    const cleared = applyPromptDefaultModel(bound, 'ask', undefined);
    expect(cleared.byMode['ask']).toBeUndefined();
  });

  it('leaves other entries untouched', () => {
    let defaults = applyPromptDefaultModel(undefined, 'ask', reference);
    defaults = applyPromptDefaultModel(defaults, 'subagent-general', reference);
    defaults = applyPromptDefaultModel(defaults, 'ask', undefined);
    expect(defaults.bySubAgent['general']).toEqual(reference);
  });

  it('binds a newly created mode/sub agent from the create form', () => {
    // The create flow routes the picked model through the same helper, keyed by
    // the id the host just derived from the name.
    const modeDefaults = applyPromptDefaultModel(
      undefined,
      'my-mode',
      toModelReference({ providerId: 'openai', modelId: 'gpt-4.1' })
    );
    expect(modeDefaults.byMode['my-mode']).toEqual(reference);

    const agentDefaults = applyPromptDefaultModel(
      modeDefaults,
      'subagent-my-agent',
      toModelReference({ providerId: 'openai', modelId: 'gpt-4.1' })
    );
    expect(agentDefaults.bySubAgent['my-agent']).toEqual(reference);
  });
});

describe('toModelReference', () => {
  it('narrows a webview reference to the domain reference', () => {
    expect(
      toModelReference({ providerId: 'openai', modelId: 'gpt-4.1' })
    ).toEqual({ providerId: ProviderId.Openai, modelId: 'gpt-4.1' });
  });

  it('maps "no selection" to undefined', () => {
    expect(toModelReference(undefined)).toBeUndefined();
  });
});
