import { describe, expect, it } from 'vitest';

import { ReasoningEffort } from '@core/ports/chat-model';
import {
  normalizeEffortLevels,
  reasoningCapabilityFromEfforts,
} from './reasoning.js';

describe('normalizeEffortLevels', () => {
  it('keeps known levels (including xhigh) in low→high order and drops unknowns', () => {
    expect(
      normalizeEffortLevels([
        'max',
        'xhigh',
        'high',
        'medium',
        'low',
        'minimal',
      ])
    ).toEqual([
      ReasoningEffort.Low,
      ReasoningEffort.Medium,
      ReasoningEffort.High,
      ReasoningEffort.XHigh,
      ReasoningEffort.Max,
    ]);
  });
});

describe('reasoningCapabilityFromEfforts', () => {
  it("pulls Copilot's advertised effort levels, treating 'none' as optional (off allowed)", () => {
    const capability = reasoningCapabilityFromEfforts([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);

    expect(capability).toEqual({
      effortLevels: [
        ReasoningEffort.Low,
        ReasoningEffort.Medium,
        ReasoningEffort.High,
        ReasoningEffort.XHigh,
        ReasoningEffort.Max,
      ],
      mandatory: false,
      defaultEffort: ReasoningEffort.Medium,
    });
  });

  it('marks reasoning mandatory when the list omits "none"', () => {
    const capability = reasoningCapabilityFromEfforts(['low', 'high']);
    expect(capability?.mandatory).toBe(true);
    expect(capability?.effortLevels).toEqual([
      ReasoningEffort.Low,
      ReasoningEffort.High,
    ]);
    // Medium isn't offered, so the default falls back to the first level.
    expect(capability?.defaultEffort).toBe(ReasoningEffort.Low);
  });

  it('returns undefined when no known levels remain so callers fall back', () => {
    expect(reasoningCapabilityFromEfforts([])).toBeUndefined();
    expect(reasoningCapabilityFromEfforts(['none'])).toBeUndefined();
  });
});
