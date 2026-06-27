import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('chat app reset flow', () => {
  const source = readFileSync(
    join(process.cwd(), 'apps/cli/src/ui/chat-app.tsx'),
    'utf8'
  );

  it('opens the reset confirmation screen from the reset command', () => {
    expect(source).toContain('setShowResetPicker(true);');
    expect(source).toContain('<ResetPicker');
  });

  it('returns to the connect flow after a confirmed reset', () => {
    expect(source).toContain('setShowConnectPicker(true);');
    expect(source).toContain('setActiveProviderId(undefined);');
    expect(source).toContain('setCurrentSessionId(newId);');
    expect(source).toContain(
      "setStatus('Reset complete · connect a provider to continue');"
    );
  });

  it('resets the in-memory config back to the default system prompt', () => {
    expect(source).toContain('systemPrompt: DEFAULT_SYSTEM_PROMPT');
    expect(source).toContain('setSavedConfig(resetConfig);');
  });
});
