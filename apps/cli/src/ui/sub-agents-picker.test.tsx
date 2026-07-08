import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('sub agents picker', () => {
  const source = readFileSync(
    join(process.cwd(), 'apps/cli/src/ui/sub-agents-picker.tsx'),
    'utf8'
  );

  it('groups agents under built-in and custom headings', () => {
    expect(source).toContain("'Built-in sub agents'");
    expect(source).toContain("'Custom sub agents'");
  });

  it('supports create, delete, and prompt editing', () => {
    expect(source).toContain('+ Create new sub agent');
    expect(source).toContain('x delete custom');
    expect(source).toContain('enter edit prompt');
    expect(source).toContain('onSavePrompt(editingId, editPrompt.trim())');
  });

  it('collects name, summary, read-only, and prompt when creating', () => {
    expect(source).toContain('CreateStep.Name');
    expect(source).toContain('CreateStep.Summary');
    expect(source).toContain('CreateStep.ReadOnly');
    expect(source).toContain('CreateStep.Prompt');
    expect(source).toContain('readOnly: true');
  });

  it('uses KeyName enums for its keyboard handling', () => {
    expect(source).toContain('KeyName.Escape');
    expect(source).toContain('KeyName.Return');
    expect(source).not.toMatch(/key\.name === '/);
  });
});

describe('chat app /sub-agents wiring', () => {
  const source = readFileSync(
    join(process.cwd(), 'apps/cli/src/ui/chat-app.tsx'),
    'utf8'
  );

  it('opens the picker from the command palette', () => {
    expect(source).toContain('case CommandName.SubAgents');
    expect(source).toContain('setShowSubAgentsPicker(true)');
    expect(source).toContain('<SubAgentsPicker');
  });
});
