import { describe, expect, it } from 'vitest';

import { buildSystemPrompt } from '@core/application/system-prompt';

describe('buildSystemPrompt', () => {
  it('always prefixes the workspace root', () => {
    const prompt = buildSystemPrompt(
      'Custom prompt',
      '/workspace/root',
      [],
      'Follow the repo rules.'
    );

    expect(prompt).toMatch(
      /^Workspace root: \/workspace\/root\n\nCustom prompt/
    );
    expect(prompt).toContain('Follow the repo rules.');
  });
});
