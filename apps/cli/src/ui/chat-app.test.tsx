import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('chat app metrics line', () => {
  const source = readFileSync(
    join(process.cwd(), 'apps/cli/src/ui/chat-app.tsx'),
    'utf8'
  );

  it('renders ctx(%) only when the active model has a known context window', () => {
    expect(source).toContain('if (pct != null)');
    expect(source).toContain("tc(' ctx(%) ', { fg: MUTED })");
    expect(source).toContain('activeModelInfo?.contextWindow == null');
  });
});
