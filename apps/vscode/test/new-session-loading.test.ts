import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('new-session loading feedback', () => {
  it('shows a spinner and disables both new-session buttons while creating', () => {
    const app = readFileSync(
      join(process.cwd(), 'apps/vscode/src/webview/App.tsx'),
      'utf8'
    );
    const sessions = readFileSync(
      join(
        process.cwd(),
        'apps/vscode/src/webview/components/SessionsView.tsx'
      ),
      'utf8'
    );

    expect(app).toContain('newSessionLoading ?');
    expect(app).toContain('disabled={state.compacting || newSessionLoading}');
    expect(sessions).toContain('disabled={newSessionLoading}');
    expect(sessions).toContain('new-session-spinner');
  });
});
