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

  it('tells the model to use lazy_load_tools only when tool use is actually needed', () => {
    const prompt = buildSystemPrompt('Custom prompt', '/workspace/root', [
      {
        name: 'lazy_load_tools',
        description: 'Reveal the full toolset when needed.',
        parameters: { type: 'object' },
      },
    ]);

    expect(prompt).toContain('If the current request can be handled');
    expect(prompt).toContain('use it only as a gateway');
    expect(prompt).toContain('After that, call the actual tool you need.');
  });
});
