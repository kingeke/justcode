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

describe('chat app queued messages', () => {
  const source = readFileSync(
    join(process.cwd(), 'apps/cli/src/ui/chat-app.tsx'),
    'utf8'
  );

  it('queues plain messages typed while a turn is sending', () => {
    expect(source).toContain('if (isSending) {');
    expect(source).toContain(
      'setQueuedMessages((queue) => [...queue, value.trim()])'
    );
  });

  it('steers the in-flight turn by draining the queue into one message', () => {
    expect(source).toContain('drainSteering: () => {');
    expect(source).toContain("const combined = queued.join('\\n\\n')");
  });

  it('sends anything left in the queue together once the turn ends', () => {
    expect(source).toContain("const combined = queuedMessages.join('\\n\\n')");
    expect(source).toContain('void submit(combined)');
  });

  it('lets the user edit the queue with the arrow keys', () => {
    expect(source).toContain('queueEditIndex !== null');
    expect(source).toContain('setQueueEditIndex(queuedMessages.length - 1)');
    expect(source).toContain('setInputWithCursorAtEnd(message)');
  });
});

describe('chat app method autocomplete', () => {
  const source = readFileSync(
    join(process.cwd(), 'apps/cli/src/ui/chat-app.tsx'),
    'utf8'
  );

  it('loads the referenced file symbols for a @path::method mention', () => {
    expect(source).toContain('getActiveSymbolMention(input)');
    expect(source).toContain(
      'props.promptAttachmentService.listSymbols(path)'
    );
  });

  it('navigates and applies the symbol suggestions like file mentions', () => {
    expect(source).toContain('showSymbolSuggestions');
    expect(source).toContain('applySymbolSuggestion(content, suggestion)');
    expect(source).toContain('applyActiveSuggestion(input, selectedSuggestion)');
  });
});

describe('chat app markdown rendering', () => {
  const source = readFileSync(
    join(process.cwd(), 'apps/cli/src/ui/chat-app.tsx'),
    'utf8'
  );

  it('renders committed messages via the tree-sitter (non-streaming) path', () => {
    // Committed messages use streaming={live} → false, so OpenTUI styles AND
    // conceals markers; the live block streams. Both need a populated SyntaxStyle.
    expect(source).toContain('streaming={live}');
    expect(source).toContain('SyntaxStyle.fromStyles(MARKDOWN_SYNTAX_STYLES)');
  });

  it('normalises committed content but leaves the live block alone', () => {
    expect(source).toContain('const prepared = live ? content : prepareMarkdown(content)');
  });
});
