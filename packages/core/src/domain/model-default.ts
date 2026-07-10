import type { ProviderId } from '@core/ports/provider-catalog';
import type { ModelInfo } from '@core/ports/chat-model';

/**
 * What a default-model binding is attached to: a chat mode or a sub agent. Used
 * by the UIs to route "set default model" to the right defaults map.
 */
export enum ModelDefaultTarget {
  Mode = 'mode',
  SubAgent = 'subAgent',
}

/**
 * A concrete pointer to one model on one provider. Used to bind a default model
 * to a chat mode or a sub agent so switching mode (or spawning a sub agent)
 * auto-selects that model. Stored in config and echoed back per session so the
 * active provider+model can be shown, exactly like the main chat footer.
 */
export interface ModelReference {
  providerId: ProviderId;
  modelId: string;
}

/**
 * Default models bound to chat modes and sub agents, keyed by their id (a
 * built-in id like `build`/`ask`/`plan`/`explorer`/`general`, or a custom id).
 * A missing entry means "no default" — the surface keeps the currently active
 * model instead of switching.
 */
export interface ModelDefaults {
  /** Default model per chat mode id. */
  byMode: Record<string, ModelReference>;
  /** Default model per sub agent id (built-in type or custom id). */
  bySubAgent: Record<string, ModelReference>;
}

/** An empty defaults map — nothing bound. */
export function emptyModelDefaults(): ModelDefaults {
  return { byMode: {}, bySubAgent: {} };
}

/**
 * Reads the default model bound to a mode id, or undefined when none is set.
 */
export function defaultModelForMode(
  modeId: string,
  defaults: ModelDefaults | undefined
): ModelReference | undefined {
  return defaults?.byMode[modeId];
}

/**
 * Reads the default model bound to a sub agent id, or undefined when none is
 * set.
 */
export function defaultModelForSubAgent(
  subAgentId: string,
  defaults: ModelDefaults | undefined
): ModelReference | undefined {
  return defaults?.bySubAgent[subAgentId];
}

/**
 * Returns a new {@link ModelDefaults} with `mode`'s default set to `reference`,
 * or cleared when `reference` is undefined. The input is not mutated.
 */
export function setModeDefaultModel(
  modeId: string,
  reference: ModelReference | undefined,
  defaults: ModelDefaults | undefined
): ModelDefaults {
  const base = defaults ?? emptyModelDefaults();
  const byMode = { ...base.byMode };
  if (reference) byMode[modeId] = reference;
  else delete byMode[modeId];
  return { byMode, bySubAgent: { ...base.bySubAgent } };
}

/**
 * Returns a new {@link ModelDefaults} with `subAgentId`'s default set to
 * `reference`, or cleared when `reference` is undefined. The input is not
 * mutated.
 */
export function setSubAgentDefaultModel(
  subAgentId: string,
  reference: ModelReference | undefined,
  defaults: ModelDefaults | undefined
): ModelDefaults {
  const base = defaults ?? emptyModelDefaults();
  const bySubAgent = { ...base.bySubAgent };
  if (reference) bySubAgent[subAgentId] = reference;
  else delete bySubAgent[subAgentId];
  return { byMode: { ...base.byMode }, bySubAgent };
}

/**
 * Validates a {@link ModelReference} against the models a provider actually
 * offers: returns the matching {@link ModelInfo} when the referenced model is
 * present, or undefined when it is missing (the caller then falls back to the
 * currently active model). `availableModels` should be the list for the
 * reference's provider.
 */
export function resolveDefaultModel(
  reference: ModelReference | undefined,
  availableModels: ModelInfo[]
): ModelInfo | undefined {
  if (!reference) return undefined;
  return availableModels.find(
    (model) =>
      model.id === reference.modelId &&
      model.providerId === reference.providerId
  );
}
