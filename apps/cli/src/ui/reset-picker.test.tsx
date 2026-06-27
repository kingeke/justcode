import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('reset picker', () => {
  const source = readFileSync(
    join(process.cwd(), 'apps/cli/src/ui/reset-picker.tsx'),
    'utf8'
  );

  it('warns that reset is irreversible and clears all app state', () => {
    expect(source).toContain('Confirm reset');
    expect(source).toContain('This action is irreversible.');
    expect(source).toContain('restore config to defaults');
    expect(source).toContain('remove all connected providers');
    expect(source).toContain('remove all pulled models');
    expect(source).toContain('remove all saved sessions');
    expect(source).toContain('Reset everything');
  });
});
