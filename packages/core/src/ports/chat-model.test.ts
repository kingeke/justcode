import { describe, expect, it } from 'vitest';

import { ReasoningDisabled, ReasoningEffort } from '@core/ports/chat-model';

describe('ReasoningDisabled', () => {
  it('Off maps to the wire literal "off"', () => {
    expect(ReasoningDisabled.Off).toBe('off');
  });

  it('is distinct from effort levels', () => {
    expect(Object.values(ReasoningEffort)).not.toContain(ReasoningDisabled.Off);
  });
});
