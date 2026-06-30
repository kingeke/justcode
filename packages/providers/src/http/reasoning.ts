import { ReasoningEffort, type ModelReasoning } from '@core/ports/chat-model';

/**
 * Shared translation of the normalized {@link ReasoningEffort} into each
 * provider's wire format, plus the model-id heuristics used to decide whether a
 * model reasons at all. The setting is global, so providers/models that don't
 * support reasoning must silently ignore it rather than 400 — these checks gate
 * the param so it is only sent where it's understood.
 */

/**
 * Model ids that accept an OpenAI-style top-level `reasoning_effort` field
 * (OpenAI o-series and GPT-5, plus the open-weight gpt-oss). Matched loosely so
 * namespaced ids (`openai/gpt-5`, `gpt-oss:20b`) still hit.
 */
const OPENAI_REASONING_MODEL = /(^|[/:])(o[1345]\b|gpt-5|gpt-oss)/i;

export function supportsReasoningEffort(model: string): boolean {
  return OPENAI_REASONING_MODEL.test(model);
}

/**
 * Reasoning capability to advertise for an OpenAI-compatible model that accepts
 * `reasoning_effort` (o-series, GPT-5, gpt-oss). These models always reason, so
 * effort is mandatory — the picker offers low/medium/high but no "off". Returns
 * undefined for models that don't reason, leaving them without a picker.
 */
export function openAiReasoningCapability(
  model: string
): ModelReasoning | undefined {
  if (!supportsReasoningEffort(model)) return undefined;
  return {
    effortLevels: [
      ReasoningEffort.Low,
      ReasoningEffort.Medium,
      ReasoningEffort.High,
    ],
    mandatory: true,
    defaultEffort: ReasoningEffort.Medium,
  };
}

/**
 * Claude models with extended thinking (3.7 and the 4.x / 5 / Fable lines).
 * Older Claude models reject the `thinking` block, so gate on this.
 */
const ANTHROPIC_THINKING_MODEL =
  /claude-(3-7|sonnet-4|opus-4|haiku-4|sonnet-5|opus-5|fable)/i;

export function supportsThinking(model: string): boolean {
  return ANTHROPIC_THINKING_MODEL.test(model);
}

/** Canonical low→high order for displaying effort levels. */
const EFFORT_ORDER: ReasoningEffort[] = [
  ReasoningEffort.Low,
  ReasoningEffort.Medium,
  ReasoningEffort.High,
];

/** Parses a provider effort string into the enum, or undefined when unknown. */
export function toReasoningEffort(
  value: string | undefined
): ReasoningEffort | undefined {
  return EFFORT_ORDER.find((effort) => effort === value);
}

/**
 * Normalizes a provider's list of supported effort strings into known levels,
 * deduplicated and sorted low→high. Unknown levels (e.g. a future "minimal")
 * are dropped rather than guessed at.
 */
export function normalizeEffortLevels(values: string[]): ReasoningEffort[] {
  const known = new Set(
    values
      .map(toReasoningEffort)
      .filter((effort): effort is ReasoningEffort => effort !== undefined)
  );
  return EFFORT_ORDER.filter((effort) => known.has(effort));
}

/** Anthropic extended-thinking token budget for a given effort level. */
export function thinkingBudgetTokens(effort: ReasoningEffort): number {
  switch (effort) {
    case ReasoningEffort.Low:
      return 4096;
    case ReasoningEffort.Medium:
      return 8192;
    case ReasoningEffort.High:
      return 16384;
  }
}
