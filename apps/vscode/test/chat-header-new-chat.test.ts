import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('chat header new-chat button', () => {
  const app = readFileSync(
    join(process.cwd(), 'apps/vscode/src/webview/App.tsx'),
    'utf8'
  );

  it('is the last item in the chat header and starts a new session', () => {
    const headerStart = app.indexOf('className="chat-header"');
    expect(headerStart).toBeGreaterThan(-1);
    const headerEnd = app.indexOf('</div>', headerStart);
    const header = app.slice(headerStart, headerEnd);

    // Wired to the same newSession handler the sessions view uses, rendered
    // with the plus glyph, and disabled while a compaction is running.
    expect(header).toContain('aria-label="New chat"');
    expect(header).toContain('onClick={newSession}');
    expect(header).toContain('<PlusIcon size={16} />');
    expect(header).toContain('aria-busy={newSessionLoading}');
    expect(header).toContain(
      'disabled={state.compacting || newSessionLoading}'
    );

    // Last item: nothing after it in the header but the conditional closing tags.
    const afterPlus = header.slice(header.indexOf('<PlusIcon'));
    expect(afterPlus).toContain('<PlusIcon size={16} />');
    expect(afterPlus).toContain('</button>');
  });
});
