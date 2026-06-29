import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('context window copy', () => {
  it('uses context window wording in the VS Code composer settings UI', () => {
    // The settings popup is rendered lazily (only while open), so assert against
    // the component source rather than static markup, mirroring the CLI check
    // below.
    const composerSource = readFileSync(
      'apps/vscode/src/webview/components/Composer.tsx',
      'utf8'
    );

    expect(composerSource).toContain('Context Window');
    expect(composerSource).toContain(
      'Recent context window items sent to model — 0 means send all'
    );
    expect(composerSource).not.toContain('Max History Sent');
  });

  it('uses context window wording in CLI help text', () => {
    const commandsSource = readFileSync('apps/cli/src/ui/commands.ts', 'utf8');
    const chatAppSource = readFileSync('apps/cli/src/ui/chat-app.tsx', 'utf8');

    expect(commandsSource).toContain('recent context window items');
    expect(commandsSource).toContain('/context-window 50');
    expect(commandsSource).not.toContain('/history-limit 50');
    expect(chatAppSource).toContain('Context window is');
    expect(chatAppSource).toContain('/context-window <count|off>');
    expect(chatAppSource).toContain('Context window set to');
    expect(chatAppSource).toContain('positive number of items');
    expect(chatAppSource).not.toContain('History limit set to');
  });
});
