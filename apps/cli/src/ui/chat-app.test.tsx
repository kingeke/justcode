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
      'setQueuedMessages((queue) => [...queue, queuedText])'
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
    expect(source).toContain('props.promptAttachmentService.listSymbols(path)');
  });

  it('navigates and applies the symbol suggestions like file mentions', () => {
    expect(source).toContain('showSymbolSuggestions');
    expect(source).toContain('applySymbolSuggestion(content, suggestion)');
    expect(source).toContain(
      'applyActiveSuggestion(input, selectedSuggestion)'
    );
  });
});

describe('chat app mode mentions', () => {
  const source = readFileSync(
    join(process.cwd(), 'apps/cli/src/ui/chat-app.tsx'),
    'utf8'
  );

  it('offers the chat modes ahead of files in the @ suggestions', () => {
    expect(source).toContain(
      'filterModeSuggestions(modes, activeMentionQuery ?? undefined)'
    );
    expect(source).toContain(
      '...modeMentionSuggestions.map((mode) => mode.id)'
    );
    expect(source).toContain(
      '...fileMentionSuggestions.filter((path) => !modeIds.has(path))'
    );
  });

  it('switches to the mentioned mode on submit and sends the stripped message', () => {
    expect(source).toContain(
      'const modeMention = getModeMention(value, modes)'
    );
    // The mode-mention submit path applies the switch (and the mode's default
    // model) through the shared applyModeChange helper.
    expect(source).toContain('applyModeChange(modeMention.modeId)');
    expect(source).toContain('setActiveMode(modeId)');
    expect(source).toContain('props.onModeChange?.(modeId)');
    expect(source).toContain(
      "const cleanedValue = messageValue.replace(IMAGE_MARKER_PATTERN, ' ').trim()"
    );
  });

  it('sends the turn on the model the mentioned mode switched to', () => {
    // applyModeChange switches the provider client synchronously, but
    // `activeModel` only updates on the next render — the turn must read the
    // returned model or it posts the old provider's model id to the new one.
    expect(source).toContain('modeSwitchModel = applyModeChange(');
    expect(source).toContain(
      'const turnModelInfo = modeSwitchModel ?? activeModelInfo'
    );
    expect(source).toContain(
      'modeSwitchModel?.id ?? (activeModel || session.activeModel)'
    );
    expect(source).toContain('turnProvider = turnModelInfo?.providerId');
  });
});

describe('chat app skill command argument hint', () => {
  const source = readFileSync(
    join(process.cwd(), 'apps/cli/src/ui/chat-app.tsx'),
    'utf8'
  );

  it('shows the hint only while the command is typed and args are empty', () => {
    expect(source).toContain('if (args.trim()) return null;');
    expect(source).toContain(
      'props.skillCommands?.resolve(name)?.command.argumentHint ?? null'
    );
  });

  it('content-sizes the textarea so the ghost hint sits after the caret', () => {
    expect(source).toContain('flexGrow={skillArgumentHint ? 0 : 1}');
    expect(source).toContain(
      '{...(skillArgumentHint ? { width: input.length + 3 } : {})}'
    );
    expect(source).toContain('{skillArgumentHint}');
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
    expect(source).toContain(
      'const prepared = live ? content : prepareMarkdown(content)'
    );
  });

  it('renders user messages as markdown like assistant messages', () => {
    expect(source).toContain('message.role === MessageRole.User ? (');
    expect(source).toContain('<MarkdownView content={message.content} />');
  });

  it('renders the task tool result as markdown in its own box', () => {
    expect(source).toContain('if (message.name === ToolName.Task) {');
    expect(source).toContain('<TaskResultBlock content={message.content} />');
    expect(source).toContain('const TaskResultBlock = React.memo(');
    expect(source).toContain('ToolName.Task,');
  });
});

describe('chat app tool diff rendering', () => {
  const source = readFileSync(
    join(process.cwd(), 'apps/cli/src/ui/chat-app.tsx'),
    'utf8'
  );

  it('keeps file diffs visible while a tool is still running', () => {
    expect(source).toContain("const running = content === ''");
    expect(source).toContain('const showDiff = running || expanded');
  });

  it('shows the result summary under the diff once a file tool finishes', () => {
    expect(source).toContain(
      '<ToolResultBlock content={content} expanded={false} />'
    );
  });

  it('preserves finished tool content across the final committed rerender when expand-tools is active', () => {
    expect(source).toContain('if (!expandTools || !prev) {');
    expect(source).toContain('const previousToolMessagesByCallId = new Map(');
    expect(source).toContain('message.role === MessageRole.Tool &&');
    expect(source).toContain("message.content !== ''");
  });
});

describe('chat app user message layout', () => {
  const source = readFileSync(
    join(process.cwd(), 'apps/cli/src/ui/chat-app.tsx'),
    'utf8'
  );

  it('right-aligns user messages and their attachments', () => {
    expect(source).toContain(
      "? { alignItems: 'flex-end' as const, paddingRight: 2 }"
    );
    expect(source).toContain("border={['right']}");
  });

  it('skips the empty content line on image-only user messages', () => {
    expect(source).toContain('{message.content ? (');
  });

  it('keeps the image-attached line emoji-free so right alignment never clips it', () => {
    expect(source).not.toContain('🖼');
  });
});

describe('chat app per-session model', () => {
  const source = readFileSync(
    join(process.cwd(), 'apps/cli/src/ui/chat-app.tsx'),
    'utf8'
  );

  it('switches to a resumed session’s stored provider before starting it', () => {
    expect(source).toContain('.loadConversation(sessionId)');
    expect(source).toContain('storedModel.providerId !== activeProviderId');
    expect(source).toContain('setActiveProviderId(storedModel.providerId);');
  });

  it('persists an explicit model switch onto the session itself', () => {
    expect(source).toContain('saveSessionModel(currentSessionId');
  });
});

describe('chat app question wizard', () => {
  const source = readFileSync(
    join(process.cwd(), 'apps/cli/src/ui/chat-app.tsx'),
    'utf8'
  );

  it('builds a wizard for the batch of questions a tool asks', () => {
    expect(source).toContain(
      'setPendingQuestion({ request, resolve, wizard: createWizard(request) })'
    );
  });

  it('marks the answer already chosen, apart from the ❯ cursor', () => {
    expect(source).toContain('answerRows(state).map');
    expect(source).toContain(
      'fg={row.cursor ? UiColor.Cyan : row.chosen ? UiColor.Green : MUTED}'
    );
    expect(source).toContain("${row.chosen ? '(•)' : '( )'}");
  });

  it('keeps the answers given so far on screen above the current question', () => {
    expect(source).toContain('answeredSummary(state).map');
    expect(source).toContain('`✓ ${entry.position}. ${entry.question} — ${');
  });

  it('seeds the textarea with the answer already typed when re-editing', () => {
    expect(source).toContain('setInputWithCursorAtEnd(next.draft)');
  });

  it('renders the step counter and the review screen', () => {
    expect(source).toContain('renderQuestionWizard(pendingQuestion.wizard)');
    expect(source).toContain('`Question ${state.index + 1} of ${total}`');
    expect(source).toContain('Review your answers');
    expect(source).toContain('✓ Submit answers');
  });

  it('drives the wizard from the keyboard while it is not taking free text', () => {
    expect(source).toContain(
      'pendingQuestion.wizard.phase !== QuestionWizardPhase.CustomInput'
    );
    expect(source).toContain('QuestionWizardActionType.MoveSelection');
    expect(source).toContain('QuestionWizardActionType.Previous');
    expect(source).toContain('QuestionWizardActionType.Next');
    expect(source).toContain('isSubmitSelection(pendingQuestion.wizard)');
  });

  it('only focuses the prompt textarea while a custom answer is typed', () => {
    expect(source).toContain(
      'pendingQuestion.wizard.phase === QuestionWizardPhase.CustomInput'
    );
    expect(source).toContain('QuestionWizardActionType.CommitCustom');
  });

  it('blurs the textarea while the wizard navigates, so Enter reaches it', () => {
    // The focus effect would otherwise re-focus the input on every wizard
    // step, and Enter would answer the question with the empty input.
    expect(source).toContain('area.blur();');
  });

  it('hands every collected answer back to the awaiting tool', () => {
    expect(source).toContain('current.resolve(wizardAnswers(state))');
    expect(source).toContain('if (shouldAutoSubmit(next))');
  });
});
