import React, {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { randomUUID } from 'node:crypto';
import {
  createTextAttributes,
  parseColor,
  StyledText,
  SyntaxStyle,
  type ScrollBoxRenderable,
  type TextareaRenderable,
  type TextChunk,
} from '@opentui/core';
import {
  useBlur,
  useFocus,
  useKeyboard,
  useRenderer,
  useSelectionHandler,
  useTerminalDimensions,
} from '@opentui/react';
import { copyToClipboard } from '@cli/ui/clipboard.js';
import { Spinner } from '@cli/ui/spinner.js';
import { ansiToStyledText } from '@cli/ui/ansi-to-styled-text.js';

import {
  applyMentionSuggestion,
  filterMentionSuggestions,
  getActiveMentionQuery,
  hasActiveMentionTrigger,
  type PromptAttachmentService,
} from '@core/application/prompt-attachment-service';
import type {
  ChatSessionService,
  StartSessionResult,
  ToolActivityEvent,
  ToolApprovalRequest,
} from '@core/application/chat-session-service';
import type { Conversation } from '@core/domain/conversation';
import { createMessage } from '@core/domain/message';
import type { ModelInfo, ProviderClient } from '@core/ports/chat-model';
import type { GlobalConfig } from '@runtime/persistence/global-config';
import { mergeProviderConfig } from '@runtime/persistence/global-config';
import { renderDiff } from '@cli/ui/render-diff.js';
import { DEFAULT_MAX_READ_LINES } from '@core/application/read-window';
import {
  COMMANDS,
  filterCommands,
  parseCommandInput,
} from '@cli/ui/commands.js';
import { openFileInEditor } from '@cli/ui/open-file.js';
import {
  ConnectPicker,
  type ConnectedProviderResult,
} from '@cli/ui/connect-picker.js';
import { ModelPicker } from '@cli/ui/model-picker.js';
import { SessionPicker } from '@cli/ui/session-picker.js';
import { ProviderId } from '@core/ports/provider-catalog.js';
import type { ConversationSummary } from '@core/ports/conversation-repository';

const MAX_COMMAND_ITEMS = 8;

const BOLD = createTextAttributes({ bold: true });
// Muted text uses an explicit grey foreground rather than the SGR "dim" attribute:
// dim renders inconsistently (often near-white) across terminals, whereas a grey
// fg reads as reliably subdued — matching the previous Ink look.
const MUTED = '#8a8a8a';

interface ChatAppProps {
  /** Exits the app (tears down the OpenTUI renderer). */
  onExit: () => void;
  /** Active provider, or undefined when nothing is connected yet. */
  providerId: ProviderId | undefined;
  savedConfig: GlobalConfig;
  configFilePath: string;
  chatSessionService: ChatSessionService;
  promptAttachmentService: PromptAttachmentService;
  sessionId: string;
  requestedModel: string | undefined;
  allProviders: ProviderClient[];
  createProvider: (id: ProviderId) => ProviderClient;
  onConfigChange: (config: GlobalConfig) => void;
  onModelChange?: (modelId: string, providerId: string) => void;
  initialThinkingCollapsed?: boolean;
  onThinkingCollapsedChange?: (collapsed: boolean) => void;
  initialAutoApplyWrites?: boolean;
  onAutoApplyWritesChange?: (autoApply: boolean) => void;
  initialExpandTools?: boolean;
  onExpandToolsChange?: (expand: boolean) => void;
  initialMaxReadLines?: number;
  onMaxReadLinesChange?: (lines: number) => void;
}

interface PendingApproval {
  request: ToolApprovalRequest;
  resolve: (approved: boolean) => void;
}

interface ToolEvent {
  key: number;
  toolName: string;
  title: string;
  status: 'running' | 'done' | 'error';
  /** Pre-rendered, colored diff for file-changing tools (if any). */
  diff?: string;
}

const MAX_PREVIEW_LINES = 16;
const EXIT_HINT = 'Press Ctrl+C again to exit';
const EXIT_WINDOW_MS = 2000;
const MARKDOWN_FG = '#d4d4d4';
const INPUT_BG = '#008B8B';

// One shared SyntaxStyle for all markdown rendering. Created lazily on first use
// (after the native renderer is initialised) so it isn't constructed at import time.
let sharedSyntaxStyle: SyntaxStyle | null = null;
function getSyntaxStyle(): SyntaxStyle {
  if (!sharedSyntaxStyle) {
    sharedSyntaxStyle = SyntaxStyle.create();
  }
  return sharedSyntaxStyle;
}

// Renders raw markdown with OpenTUI's native <markdown> renderable, which lays out
// tables, headings, lists and code blocks correctly inside the TUI (the previous
// marked-terminal → ANSI pipeline mangled tables). Mirrors opencode's approach.
function MarkdownView({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}): React.ReactNode {
  return (
    <markdown
      content={content}
      syntaxStyle={getSyntaxStyle()}
      streaming={streaming}
      tableOptions={{ style: 'grid' }}
      fg={MARKDOWN_FG}
      flexShrink={0}
    />
  );
}

// OpenTUI's <text> mis-lays-out a mix of bare-string and <span> inline children,
// so any styled-inline line is built as a single StyledText (`content`) of chunks.
function tc(
  text: string,
  opts: { fg?: string; bold?: boolean } = {}
): TextChunk {
  const chunk: TextChunk = { __isChunk: true, text };
  if (opts.fg) chunk.fg = parseColor(opts.fg);
  if (opts.bold) chunk.attributes = BOLD;
  return chunk;
}

function commandLineContent(
  cmd: (typeof COMMANDS)[number],
  isSelected: boolean,
  state: {
    thinkingCollapsed: boolean;
    autoApplyWrites: boolean;
    expandTools: boolean;
    maxReadLines: number;
  }
): StyledText {
  const lead = isSelected ? { fg: 'cyan' } : {};
  const chunks: TextChunk[] = [
    tc(isSelected ? '› ' : '  ', lead),
    tc(`/${cmd.name}`, { ...lead, bold: isSelected }),
    tc('  ', lead),
  ];
  const description =
    cmd.name === 'thinking'
      ? state.thinkingCollapsed
        ? 'Expand thinking'
        : 'Collapse thinking'
      : cmd.description;
  chunks.push(tc(description, { fg: MUTED }));

  if (cmd.name === 'auto-writes') {
    chunks.push(
      tc('  '),
      tc(`[${state.autoApplyWrites ? 'on' : 'off'}]`, {
        fg: state.autoApplyWrites ? 'green' : 'yellow',
      })
    );
  } else if (cmd.name === 'expand-tools') {
    chunks.push(
      tc('  '),
      tc(`[${state.expandTools ? 'on' : 'off'}]`, {
        fg: state.expandTools ? 'green' : 'yellow',
      })
    );
  } else if (cmd.name === 'read-limit') {
    chunks.push(tc('  '), tc(`[${state.maxReadLines} lines]`, { fg: 'green' }));
  }

  return new StyledText(chunks);
}

function metricsLineContent(
  metrics: ReturnType<typeof getInitialMetrics>,
  activeModelInfo: ModelInfo | null
): StyledText {
  const cachedTokens = metrics.cachedTokens;
  const newTokens = Math.max(metrics.inputTokens - cachedTokens, 0);
  const pct = activeModelInfo?.contextWindow
    ? contextPct(metrics.lastInputTokens, activeModelInfo.contextWindow)
    : 0;

  const chunks: TextChunk[] = [
    tc('ctx ', { fg: MUTED }),
    tc(metrics.inputTokens.toLocaleString(), { fg: 'white' }),
    tc(' cached ', { fg: MUTED }),
    tc(cachedTokens.toLocaleString(), { fg: 'white' }),
    tc(' new ', { fg: MUTED }),
    tc(newTokens.toLocaleString(), { fg: 'white' }),
    tc(' out ', { fg: MUTED }),
    tc(metrics.outputTokens.toLocaleString(), { fg: 'white' }),
    tc(' ctx(%) ', { fg: MUTED }),
    tc(`${pct}%`, { fg: pct > 80 ? 'yellow' : 'white' }),
  ];

  if (metrics.cost > 0) {
    chunks.push(
      tc(' $', { fg: MUTED }),
      tc(metrics.cost.toFixed(4), { fg: 'white' })
    );
  }

  return new StyledText(chunks);
}

function statusLineContent(status: string): StyledText {
  return new StyledText([
    { __isChunk: true, text: status, fg: parseColor(MUTED) },
  ]);
}

function getInitialMetrics(): {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cost: number;
  lastInputTokens: number;
} {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    cost: 0,
    lastInputTokens: 0,
  };
}

export function ChatApp(props: ChatAppProps): React.ReactNode {
  const exit = props.onExit;
  // Full-screen layout: the root fills the terminal and the transcript lives in a
  // bottom-sticky <scrollbox>, since OpenTUI runs in the alternate screen and does
  // not use the terminal's native scrollback the way Ink's flowing output did.
  const dimensions = useTerminalDimensions();
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const [terminalFocused, setTerminalFocused] = useState(true);
  const scrollToBottom = useCallback((): void => {
    const scroll = scrollRef.current;
    if (scroll && !scroll.isDestroyed) {
      scroll.scrollTo(scroll.scrollHeight);
    }
  }, []);
  // No provider connected yet: open straight into the connect screen and hold
  // off on starting a session until the user picks one.
  const needsConnect = props.providerId === undefined;
  const [showConnectPicker, setShowConnectPicker] = useState(needsConnect);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  // When the model picker is opened right after connecting, it shows only the
  // freshly connected provider's models (allModels hasn't refreshed yet).
  const [connectModels, setConnectModels] = useState<ModelInfo[] | null>(null);
  const [sessionSummaries, setSessionSummaries] = useState<
    ConversationSummary[]
  >([]);
  const [sessionSummariesLoading, setSessionSummariesLoading] = useState(false);
  const [allModels, setAllModels] = useState<ModelInfo[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState(props.sessionId);
  const [session, setSession] = useState<StartSessionResult | null>(null);
  const [activeModel, setActiveModel] = useState<string>('');
  const [activeModelInfo, setActiveModelInfo] = useState<ModelInfo | null>(
    null
  );
  const [activeProviderId, setActiveProviderId] = useState(props.providerId);
  const [connectedProviders, setConnectedProviders] = useState<
    ProviderClient[]
  >([]);
  const [savedConfig, setSavedConfig] = useState(props.savedConfig);
  const [metrics, setMetrics] = useState(getInitialMetrics);
  const [lastStats, setLastStats] = useState<{
    ttftMs: number;
    tokensPerSecond: number;
    avgTokensPerSecond: number;
  } | null>(null);
  const sessionStatsRef = useRef({
    outputTokens: 0,
    generationMs: 0,
  });
  const responseTimingRef = useRef<{
    startMs: number;
    firstTokenMs: number | null;
  }>({ startMs: 0, firstTokenMs: null });
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [input, setInput] = useState('');
  // Bumping this remounts the text input so its cursor jumps to the end after
  // we replace the value programmatically (tab-completion); ink-text-input
  // otherwise keeps its own cursor offset.
  const [inputKey, setInputKey] = useState(0);
  const promptAreaRef = useRef<TextareaRenderable | null>(null);

  const setInputWithCursorAtEnd = useCallback((next: string): void => {
    setInput(next);
    setInputKey((key) => key + 1);
  }, []);
  const currentSessionLabel = conversation?.title ?? currentSessionId;
  const activeRequestControllerRef = useRef<AbortController | null>(null);
  const nextSessionRequestedModelRef = useRef<string | undefined>(undefined);
  // The raw prompt of the in-flight request, restored to the input if the user
  // interrupts so they can edit and resend without retyping.
  const submittedPromptRef = useRef<string>('');
  const interruptedPromptRef = useRef<string | null>(null);

  const cancelActiveRequest = (): void => {
    activeRequestControllerRef.current?.abort();
  };

  const resetFreshSessionState = (): void => {
    cancelActiveRequest();
    setPendingApproval((current) => {
      current?.resolve(false);
      return null;
    });
    setIsSending(false);
    setConversation(null);
    setError(null);
    setLastStats(null);
    setMetrics(getInitialMetrics());
    setStreamingContent('');
    setStreamingThinking('');
    setThinkingDuration(null);
    setToolEvents([]);
    setMessageThinking({});
    streamingBufferRef.current = '';
    thinkingRef.current = { buffer: '', startMs: 0, durationMs: null };
    responseTimingRef.current = { startMs: 0, firstTokenMs: null };
    sessionStatsRef.current = { outputTokens: 0, generationMs: 0 };
  };
  const [status, setStatus] = useState<string>('Loading session...');
  const [isSending, setIsSending] = useState(false);
  const [activityTick, setActivityTick] = useState(0);
  const [streamingContent, setStreamingContent] = useState<string>('');
  const streamingBufferRef = useRef('');
  const [streamingThinking, setStreamingThinking] = useState<string>('');
  const [thinkingDuration, setThinkingDuration] = useState<number | null>(null);
  const thinkingRef = useRef<{
    buffer: string;
    startMs: number;
    durationMs: number | null;
  }>({
    buffer: '',
    startMs: 0,
    durationMs: null,
  });
  const [messageThinking, setMessageThinking] = useState<
    Record<string, { content: string; durationMs: number }>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [thinkingCollapsed, setThinkingCollapsed] = useState(
    props.initialThinkingCollapsed ?? false
  );
  const [autoApplyWrites, setAutoApplyWrites] = useState(
    props.initialAutoApplyWrites ?? false
  );
  const autoApplyWritesRef = useRef(props.initialAutoApplyWrites ?? false);
  const [expandTools, setExpandTools] = useState(
    props.initialExpandTools ?? true
  );
  const maxReadLinesRef = useRef(
    props.initialMaxReadLines ?? DEFAULT_MAX_READ_LINES
  );
  const [maxReadLines, setMaxReadLines] = useState(
    props.initialMaxReadLines ?? DEFAULT_MAX_READ_LINES
  );
  const [pendingApproval, setPendingApproval] =
    useState<PendingApproval | null>(null);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const toolEventKeyRef = useRef(0);
  // The synthetic tool-call id of the bash command currently running, so its
  // optimistic placeholder message can be filled in when the call finishes.
  const liveBashCallRef = useRef<string | null>(null);
  // Index into the finished bash rows while browsing them with the keyboard;
  // null means we're not browsing (the prompt has focus as usual).
  const [browseIndex, setBrowseIndex] = useState<number | null>(null);
  const [expandedBashIds, setExpandedBashIds] = useState<Set<string>>(
    () => new Set()
  );
  // Pair each bash result with the command that produced it: the command lives
  // on the assistant's tool call, the output on the following `tool` message.
  const bashCommandByCallId = useMemo(() => {
    const map = new Map<string, string>();
    for (const message of conversation?.messages ?? []) {
      if (message.role !== 'assistant' || !message.toolCalls) continue;
      for (const call of message.toolCalls) {
        if (call.name === 'bash') map.set(call.id, call.arguments);
      }
    }
    return map;
  }, [conversation]);
  // The finished bash results, in conversation order — what the user browses.
  const bashToolMessages = useMemo(
    () =>
      (conversation?.messages ?? []).filter(
        (message) => message.role === 'tool' && message.name === 'bash'
      ),
    [conversation]
  );
  const selectedBashMessage =
    browseIndex !== null ? bashToolMessages[browseIndex] : undefined;
  const selectedBashId = selectedBashMessage?.id;

  const refreshWorkspaceFiles = useCallback((): void => {
    void props.promptAttachmentService
      .listFiles()
      .then((files) => {
        startTransition(() => setWorkspaceFiles(files));
      })
      .catch((caughtError: unknown) => {
        setError(getErrorMessage(caughtError));
      });
  }, [props.promptAttachmentService]);

  const toggleBashExpanded = (id: string): void => {
    setExpandedBashIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  // Armed by a Ctrl+C that didn't exit (it cleared text or hit an empty input);
  // the next Ctrl+C exits, but only within the EXIT_WINDOW_MS window. Disarmed
  // as soon as the user types again, or when the window times out.
  const exitArmedRef = useRef(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const disarmExit = useCallback((): void => {
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    if (exitArmedRef.current) {
      exitArmedRef.current = false;
      setStatus((current) => (current === EXIT_HINT ? 'Ready' : current));
    }
  }, []);

  const armExit = useCallback((): void => {
    exitArmedRef.current = true;
    setStatus(EXIT_HINT);
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    exitTimerRef.current = setTimeout(() => {
      exitTimerRef.current = null;
      disarmExit();
    }, EXIT_WINDOW_MS);
  }, [disarmExit]);

  const isCommandMode = input.startsWith('/') && !input.includes(' ');
  const commandQuery = isCommandMode ? (parseCommandInput(input) ?? '') : '';
  const filteredCommands = useMemo(
    () => (isCommandMode ? filterCommands(commandQuery) : []),
    [isCommandMode, commandQuery]
  );
  const visibleCommands = filteredCommands.slice(0, MAX_COMMAND_ITEMS);

  const activeMentionQuery = useMemo(
    () => (isCommandMode ? null : getActiveMentionQuery(input)),
    [isCommandMode, input]
  );
  const activeMentionTrigger = useMemo(
    () => (isCommandMode ? false : hasActiveMentionTrigger(input)),
    [isCommandMode, input]
  );
  const showInterruptHint = isSending || pendingApproval !== null;
  const displayStats = isSending
    ? getLiveStats(
        responseTimingRef.current,
        streamingThinking + streamingContent,
        activityTick,
        sessionStatsRef.current
      )
    : lastStats;
  const mentionSuggestions = useMemo(
    () =>
      filterMentionSuggestions(workspaceFiles, activeMentionQuery ?? undefined),
    [activeMentionQuery, workspaceFiles]
  );
  const showMentionSuggestions =
    activeMentionTrigger && !isCommandMode && workspaceFiles.length > 0;
  const noMentionMatches =
    activeMentionTrigger &&
    activeMentionQuery !== undefined &&
    mentionSuggestions.length === 0;
  const selectedSuggestion =
    mentionSuggestions[selectedSuggestionIndex] ?? mentionSuggestions[0];

  useEffect(() => {
    if (!activeMentionTrigger || isCommandMode) {
      return;
    }

    refreshWorkspaceFiles();
  }, [
    activeMentionQuery,
    activeMentionTrigger,
    isCommandMode,
    refreshWorkspaceFiles,
  ]);

  useEffect(() => {
    const area = promptAreaRef.current;
    if (!area || area.isDestroyed) return;

    if (area.plainText !== input) {
      area.setText(input);
      area.cursorOffset = input.length;
    }

    if (!isSending && browseIndex === null) {
      queueMicrotask(() => {
        if (
          !promptAreaRef.current ||
          promptAreaRef.current.isDestroyed ||
          isSending ||
          browseIndex !== null
        ) {
          return;
        }

        promptAreaRef.current.focus();
      });
    }
  }, [browseIndex, input, isSending]);

  useFocus(() => {
    setTerminalFocused(true);
  });

  useBlur(() => {
    setTerminalFocused(false);
  });

  useEffect(() => {
    if (!terminalFocused || isSending || browseIndex !== null) {
      return;
    }

    const area = promptAreaRef.current;
    if (!area || area.isDestroyed) {
      return;
    }

    area.focus();
  }, [browseIndex, isSending, terminalFocused]);

  const configuredProviderIds = Object.keys(
    savedConfig.providers ?? {}
  ) as ProviderId[];
  const configuredProviders = savedConfig.providers ?? {};

  const availableProviders = useMemo(
    () => mergeProviders(props.allProviders, connectedProviders),
    [connectedProviders, props.allProviders]
  );

  const resolveProviderClient = (providerId: ProviderId): ProviderClient =>
    availableProviders.find((provider) => provider.providerId === providerId) ??
    props.createProvider(providerId);

  const renderer = useRenderer();

  // Transient "Copied" toast shown bottom-right after a selection is copied.
  const [copiedNotice, setCopiedNotice] = useState(false);
  const copiedNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // Copy text as soon as the user finishes highlighting it with the mouse
  // (the "selection" event fires once on mouse-up). Prefers OSC52 (works over
  // SSH) and falls back to the platform's native clipboard CLI. We keep the
  // highlight visible — copying is a side effect, not a selection change.
  useSelectionHandler((selection) => {
    const selectedText = selection.getSelectedText();
    if (!selectedText.trim()) return;

    if (!renderer.copyToClipboardOSC52(selectedText)) {
      copyToClipboard(selectedText);
    }

    setCopiedNotice(true);
    if (copiedNoticeTimerRef.current) {
      clearTimeout(copiedNoticeTimerRef.current);
    }
    copiedNoticeTimerRef.current = setTimeout(() => {
      setCopiedNotice(false);
      copiedNoticeTimerRef.current = null;
    }, 1500);
  });

  useEffect(
    () => () => {
      if (copiedNoticeTimerRef.current) {
        clearTimeout(copiedNoticeTimerRef.current);
      }
    },
    []
  );

  useKeyboard((key) => {
    if (showModelPicker || showConnectPicker || showSessionPicker) return;

    const value = key.sequence ?? '';

    if (pendingApproval) {
      const choice = value.toLowerCase();
      if (key.ctrl && key.name === 'c') {
        exit();
        return;
      }
      if (choice === 'y' || key.name === 'return') {
        resolveApproval(true, false);
      } else if (choice === 'a') {
        resolveApproval(true, true);
      } else if (choice === 'n') {
        resolveApproval(false, false);
      } else if (key.name === 'escape') {
        cancelActiveRequest();
      }
      return;
    }

    if (key.ctrl && key.name === 'c') {
      // A second Ctrl+C within the window exits.
      if (exitArmedRef.current) {
        exit();
        return;
      }
      // Otherwise clear any typed text and arm exit for EXIT_WINDOW_MS.
      if (input) setInputWithCursorAtEnd('');
      armExit();
      return;
    }

    // Browsing finished bash commands: arrows move the selection, Enter/Space
    // toggle the selected command's output box, Esc returns to the prompt.
    if (browseIndex !== null) {
      if (key.name === 'escape') {
        setBrowseIndex(null);
        return;
      }
      if (key.name === 'up') {
        setBrowseIndex((i) => Math.max(0, (i ?? 0) - 1));
        return;
      }
      if (key.name === 'down') {
        setBrowseIndex((i) =>
          Math.min(bashToolMessages.length - 1, (i ?? 0) + 1)
        );
        return;
      }
      if (key.name === 'return' || key.name === 'space') {
        if (selectedBashId !== undefined) {
          toggleBashExpanded(selectedBashId);
        }
        return;
      }
      // Swallow everything else so stray keys don't leak while browsing.
      return;
    }

    // Enter browse mode from an empty prompt when there are bash results.
    // Skipped when /expand-tools is on, since every box is already inline.
    if (
      key.name === 'up' &&
      !input &&
      !isSending &&
      !expandTools &&
      bashToolMessages.length > 0 &&
      !isCommandMode &&
      !showMentionSuggestions
    ) {
      setBrowseIndex(bashToolMessages.length - 1);
      return;
    }

    if (key.name === 'escape') {
      if (isSending) {
        cancelActiveRequest();
        return;
      }

      if (input) {
        setInputWithCursorAtEnd('');
        disarmExit();
        setStatus('Ready');
        return;
      }

      exit();
      return;
    }

    if (isCommandMode && visibleCommands.length) {
      if (key.name === 'down') {
        setSelectedCommandIndex((i) =>
          Math.min(i + 1, visibleCommands.length - 1)
        );
        return;
      }
      if (key.name === 'up') {
        setSelectedCommandIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (key.name === 'tab') {
        const cmd = visibleCommands[selectedCommandIndex];
        if (cmd) setInputWithCursorAtEnd(`/${cmd.name} `);
        return;
      }
      return;
    }

    if (!showMentionSuggestions) return;

    if (key.name === 'down') {
      setSelectedSuggestionIndex((i) =>
        Math.min(i + 1, mentionSuggestions.length - 1)
      );
      return;
    }
    if (key.name === 'up') {
      setSelectedSuggestionIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (key.name === 'tab') {
      if (selectedSuggestion) {
        setInput((cur) => applyMentionSuggestion(cur, selectedSuggestion));
        setInputKey((key) => key + 1);
      }
    }
  });

  useEffect(() => {
    setSelectedCommandIndex(0);
  }, [commandQuery]);

  useEffect(() => {
    setSelectedSuggestionIndex(0);
  }, [activeMentionQuery]);

  useEffect(() => {
    if (isSending) return;

    const restoredPrompt = interruptedPromptRef.current;
    if (restoredPrompt === null) return;

    interruptedPromptRef.current = null;
    setInput(restoredPrompt);

    const promptArea = promptAreaRef.current;
    if (promptArea && !promptArea.isDestroyed) {
      promptArea.setText(restoredPrompt);
      promptArea.cursorOffset = restoredPrompt.length;
    }
  }, [isSending]);

  // Snap the transcript to the bottom when a message is committed. Per-token
  // streaming growth is handled by the scrollbox's stickyScroll, so this only
  // fires on discrete message changes and never yanks the user back while they
  // scroll up through history mid-response.
  useEffect(() => {
    scrollToBottom();
  }, [conversation?.messages.length, scrollToBottom]);

  // Leave browse mode if there are no rows to point at, and clamp the cursor if
  // the list shrank (e.g. a new session cleared the conversation).
  useEffect(() => {
    setBrowseIndex((current) => {
      if (current === null) return null;
      if (bashToolMessages.length === 0) return null;
      return Math.min(current, bashToolMessages.length - 1);
    });
  }, [bashToolMessages.length]);

  useEffect(() => {
    return () => {
      activeRequestControllerRef.current?.abort();
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, []);

  // Typing cancels a pending "Ctrl+C again to exit".
  useEffect(() => {
    if (input && exitArmedRef.current) {
      disarmExit();
    }
  }, [input, disarmExit]);

  const loadSession = (sessionId: string, requestedModel?: string): void => {
    resetFreshSessionState();
    setStatus('Loading session...');
    setSession(null);
    setConversation(null);
    setActiveModel('');
    setActiveModelInfo(null);
    const modelForSession = requestedModel ?? props.requestedModel;
    void props.chatSessionService
      .startSession(
        modelForSession
          ? { sessionId, requestedModel: modelForSession }
          : { sessionId }
      )
      .then((startedSession) => {
        const modelInfo =
          startedSession.availableModels.find(
            (m) => m.id === startedSession.activeModel
          ) ?? null;
        startTransition(() => {
          setSession(startedSession);
          setActiveModel(startedSession.activeModel);
          setConversation(startedSession.conversation);
          setActiveModelInfo(modelInfo);
          setStatus('Ready');
        });
      })
      .catch((caughtError: unknown) => {
        setError(getErrorMessage(caughtError));
        setStatus('Failed to start session');
      });
  };

  useEffect(() => {
    // Don't start a session until a provider is connected; the connect screen
    // drives the first load via handleConnectComplete.
    if (!activeProviderId) return;
    loadSession(currentSessionId, nextSessionRequestedModelRef.current);
    nextSessionRequestedModelRef.current = undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId]);

  useEffect(() => {
    refreshWorkspaceFiles();
  }, [refreshWorkspaceFiles]);

  useEffect(() => {
    if (!activeMentionTrigger || isCommandMode) {
      return;
    }

    refreshWorkspaceFiles();
  }, [
    activeMentionQuery,
    activeMentionTrigger,
    isCommandMode,
    refreshWorkspaceFiles,
  ]);

  useEffect(() => {
    void Promise.allSettled(availableProviders.map((p) => p.listModels())).then(
      (results) => {
        const models = results
          .filter((r) => r.status === 'fulfilled')
          .flatMap((r) => r.value);
        startTransition(() => setAllModels(models));
      }
    );
  }, [availableProviders]);

  useEffect(() => {
    if (!showSessionPicker) return;

    let cancelled = false;
    setSessionSummariesLoading(true);
    void props.chatSessionService
      .listSessions()
      .then((sessions) => {
        if (cancelled) return;
        startTransition(() => {
          setSessionSummaries(sessions);
          setSessionSummariesLoading(false);
        });
      })
      .catch((caughtError: unknown) => {
        if (cancelled) return;
        setSessionSummaries([]);
        setSessionSummariesLoading(false);
        setError(getErrorMessage(caughtError));
      });

    return () => {
      cancelled = true;
    };
  }, [props.chatSessionService, showSessionPicker]);

  const handleModelSelect = (model: ModelInfo): void => {
    setShowModelPicker(false);
    setConnectModels(null);
    if (model.providerId !== activeProviderId) {
      try {
        const newProvider = resolveProviderClient(model.providerId);
        props.chatSessionService.switchProvider(newProvider);
        setActiveProviderId(model.providerId);
      } catch (e) {
        setError(getErrorMessage(e));
        return;
      }
    }
    setActiveModel(model.id);
    setActiveModelInfo(model);
    props.onModelChange?.(model.id, model.providerId);
    // First model chosen right after connecting: no session exists yet, so
    // start one now with the chosen model.
    if (!session) {
      loadSession(currentSessionId, model.id);
      return;
    }
    setStatus(`Switched to ${model.displayName}`);
  };

  const handleConnectComplete = async ({
    providerId,
    client,
    selectedModel,
    models,
    config,
    provider,
  }: ConnectedProviderResult): Promise<void> => {
    const nextConfig = mergeProviderConfig(savedConfig, providerId, config);

    setConnectedProviders((current) => {
      const next = current.filter(
        (provider) => provider.providerId !== providerId
      );
      next.push(client);
      return next;
    });
    props.onConfigChange(nextConfig);
    setSavedConfig(nextConfig);
    props.chatSessionService.switchProvider(client);
    setActiveProviderId(providerId);
    setStatus(`Connected to ${provider.name} · choose a model`);
    setShowConnectPicker(false);
    // Hand off to the model picker (seeded with this provider's models, and
    // highlighting the default) so the user chooses which model to use. The
    // session starts once they pick — see handleModelSelect.
    setActiveModel(selectedModel.id);
    setActiveModelInfo(selectedModel);
    setConnectModels(models);
    setShowModelPicker(true);
  };

  const resolveApproval = (approved: boolean, always: boolean): void => {
    if (always) {
      setAutoApplyWrites(true);
      autoApplyWritesRef.current = true;
      props.onAutoApplyWritesChange?.(true);
    }
    setPendingApproval((current) => {
      current?.resolve(approved);
      return null;
    });
  };

  const executeCommand = (name: string, arg?: string): void => {
    setInput('');
    setError(null);

    if (name === 'models') {
      setShowModelPicker(true);
      return;
    }

    if (name === 'sessions') {
      setShowSessionPicker(true);
      return;
    }

    if (name === 'connect') {
      setStatus('Select a provider to connect');
      setShowConnectPicker(true);
      return;
    }

    if (name === 'config') {
      void openFileInEditor(props.configFilePath)
        .then(() => {
          setStatus('Opened config file');
        })
        .catch((caughtError: unknown) => {
          setError(getErrorMessage(caughtError));
        });
      return;
    }

    if (name === 'read-limit') {
      const trimmed = (arg ?? '').trim();
      const current = maxReadLinesRef.current;
      if (!trimmed) {
        setStatus(
          `Read limit is ${current} lines (use /read-limit <lines> to change)`
        );
        return;
      }
      const lines = Number.parseInt(trimmed, 10);
      if (!Number.isFinite(lines) || lines <= 0) {
        setError(
          `Invalid read limit '${trimmed}'. Provide a positive number of lines.`
        );
        return;
      }
      maxReadLinesRef.current = lines;
      setMaxReadLines(lines);
      props.onMaxReadLinesChange?.(lines);
      setStatus(`Read limit set to ${lines} lines`);
      return;
    }

    if (name === 'auto-writes') {
      const next = !autoApplyWritesRef.current;
      setAutoApplyWrites(next);
      autoApplyWritesRef.current = next;
      props.onAutoApplyWritesChange?.(next);
      setStatus(next ? 'Auto-applying writes' : 'Confirming each write');
      return;
    }

    if (name === 'expand-tools') {
      const next = !expandTools;
      setExpandTools(next);
      props.onExpandToolsChange?.(next);
      setStatus(
        next ? 'Showing full tool output inline' : 'Collapsing tool output'
      );
      return;
    }

    if (name === 'thinking') {
      const next = !thinkingCollapsed;
      setThinkingCollapsed(next);
      props.onThinkingCollapsedChange?.(next);
      setStatus(next ? 'Thinking collapsed' : 'Thinking expanded');
      return;
    }

    if (name === 'new-session') {
      resetFreshSessionState();
      const newId = randomUUID();
      const nextRequestedModel = activeModel || props.requestedModel;
      nextSessionRequestedModelRef.current = nextRequestedModel;
      setCurrentSessionId(newId);
      return;
    }

    if (name === 'clear') {
      resetFreshSessionState();
      void props.chatSessionService
        .clearSession(currentSessionId)
        .then((fresh) => {
          startTransition(() => {
            setConversation(fresh);
            setStatus('Ready');
          });
        })
        .catch((caughtError: unknown) => {
          setError(getErrorMessage(caughtError));
        });
    }
  };

  const submit = async (value: string): Promise<void> => {
    if (isSending || !value.trim()) return;

    if (showMentionSuggestions && selectedSuggestion) {
      setInputWithCursorAtEnd(
        applyMentionSuggestion(value, selectedSuggestion)
      );
      return;
    }

    const commandInput = parseCommandInput(value);
    if (commandInput !== null) {
      const spaceIndex = commandInput.indexOf(' ');
      const hasArg = spaceIndex !== -1;
      const commandName = hasArg
        ? commandInput.slice(0, spaceIndex)
        : commandInput;
      const arg = hasArg ? commandInput.slice(spaceIndex + 1) : undefined;

      if (hasArg) {
        // Explicit name + argument (e.g. "/read-limit 64").
        if (COMMANDS.some((c) => c.name === commandName)) {
          executeCommand(commandName, arg);
        } else {
          setError(`Unknown command '/${commandName}'.`);
        }
      } else {
        // No argument: prefer an exact name (e.g. after tab-completing and
        // submitting), otherwise honour the highlighted suggestion.
        const exact = COMMANDS.find((c) => c.name === commandName);
        const selected = exact ?? visibleCommands[selectedCommandIndex];
        if (selected) executeCommand(selected.name);
      }
      setInput('');
      return;
    }

    if (!conversation || !session) return;

    const requestController = new AbortController();
    activeRequestControllerRef.current = requestController;
    submittedPromptRef.current = value;

    const baseConversation = conversation;

    setError(null);
    setIsSending(true);
    // Show the user's message immediately, before the model starts responding.
    const optimisticUserMessage = createMessage('user', value.trim());
    setConversation({
      ...baseConversation,
      messages: [...baseConversation.messages, optimisticUserMessage],
    });
    setStreamingContent('');
    setStreamingThinking('');
    setThinkingDuration(null);
    setToolEvents([]);
    setBrowseIndex(null);
    streamingBufferRef.current = '';
    thinkingRef.current = { buffer: '', startMs: 0, durationMs: null };
    responseTimingRef.current = { startMs: Date.now(), firstTokenMs: null };
    setLastStats(null);
    setInput('');
    setStatus('Waiting for response...');

    const flushInterval = setInterval(() => {
      setActivityTick((tick) => tick + 1);
      const t = thinkingRef.current;
      if (t.buffer) setStreamingThinking(t.buffer);
      if (t.durationMs !== null) setThinkingDuration(t.durationMs);
      const cBuf = streamingBufferRef.current;
      if (cBuf) setStreamingContent(cBuf);
    }, 50);

    const requestApproval = (
      request: ToolApprovalRequest
    ): Promise<boolean> => {
      if (autoApplyWritesRef.current) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        setStatus('Awaiting approval...');
        setPendingApproval({ request, resolve });
      });
    };

    const onToolActivity = (event: ToolActivityEvent): void => {
      if (event.phase === 'start') {
        // A tool is running; drop the streamed preamble (text + thinking) so it
        // doesn't render out of order below the tool. Thinking is preserved in
        // thinkingRef and re-anchored to the turn's first message at the end.
        streamingBufferRef.current = '';
        setStreamingContent('');
        setStreamingThinking('');

        if (event.toolName === 'bash') {
          // Splice an optimistic assistant(tool call) + tool(running) pair into
          // the displayed transcript so the box renders in place immediately,
          // not in a trailing block. The real messages replace these when the
          // turn commits (see the success path's setConversation).
          const callId = `live-${(toolEventKeyRef.current += 1)}`;
          liveBashCallRef.current = callId;
          const command = event.view.preview ?? '';
          setConversation((prev) =>
            prev
              ? {
                  ...prev,
                  messages: [
                    ...prev.messages,
                    createMessage('assistant', '', new Date(), undefined, {
                      toolCalls: [
                        {
                          id: callId,
                          name: 'bash',
                          arguments: JSON.stringify({ command }),
                        },
                      ],
                    }),
                    // Empty content marks it as still running (a finished call
                    // always has non-empty content, e.g. "(no output)").
                    createMessage('tool', '', new Date(), undefined, {
                      toolCallId: callId,
                      name: 'bash',
                    }),
                  ],
                }
              : prev
          );
          return;
        }

        // Non-bash tools (file writes/edits) keep the live bottom indicator:
        // their diff preview isn't stored on the conversation message.
        const key = (toolEventKeyRef.current += 1);
        setToolEvents((prev) => [
          ...prev,
          {
            key,
            toolName: event.toolName,
            title: event.view.title,
            status: 'running',
            ...(event.view.diff ? { diff: renderDiff(event.view.diff) } : {}),
          },
        ]);
        return;
      }

      if (event.toolName === 'bash') {
        const callId = liveBashCallRef.current;
        liveBashCallRef.current = null;
        if (!callId) return;
        const content = event.result?.content || '(no output)';
        setConversation((prev) =>
          prev
            ? {
                ...prev,
                messages: prev.messages.map((message) =>
                  message.role === 'tool' && message.toolCallId === callId
                    ? { ...message, content }
                    : message
                ),
              }
            : prev
        );
        return;
      }

      setToolEvents((prev) => {
        const next = [...prev];
        for (let index = next.length - 1; index >= 0; index -= 1) {
          const entry = next[index];
          if (entry?.status === 'running') {
            next[index] = {
              ...entry,
              status: event.result?.isError ? 'error' : 'done',
            };
            break;
          }
        }
        return next;
      });
    };

    try {
      const attachments =
        await props.promptAttachmentService.resolveAttachments(
          value,
          requestController.signal
        );
      const result = await props.chatSessionService.submitMessage({
        conversation: baseConversation,
        model: activeModel || session.activeModel,
        content: value,
        attachments,
        signal: requestController.signal,
        requestApproval,
        onToolActivity,
        onToken: (token) => {
          if (responseTimingRef.current.firstTokenMs === null) {
            responseTimingRef.current.firstTokenMs = Date.now();
          }
          if (
            thinkingRef.current.startMs &&
            thinkingRef.current.durationMs === null
          ) {
            thinkingRef.current.durationMs =
              Date.now() - thinkingRef.current.startMs;
          }
          streamingBufferRef.current += token;
        },
        onThinkingToken: (token) => {
          if (responseTimingRef.current.firstTokenMs === null) {
            responseTimingRef.current.firstTokenMs = Date.now();
          }
          if (!thinkingRef.current.startMs) {
            thinkingRef.current.startMs = Date.now();
          }
          thinkingRef.current.buffer += token;
        },
      });

      const endMs = Date.now();
      const timing = responseTimingRef.current;
      // Attach the turn's thinking to the FIRST assistant message it produced,
      // not the last: the reasoning precedes any tool calls, so anchoring it
      // here keeps the transcript order thinking → tool use → answer.
      const newMessages = result.conversation.messages.slice(
        baseConversation.messages.length
      );
      const thinkingAnchor = newMessages.find(
        (message) => message.role === 'assistant'
      );
      const capturedThinking = thinkingRef.current.buffer;
      const capturedContent = streamingBufferRef.current;
      const capturedDuration =
        thinkingRef.current.durationMs ??
        (thinkingRef.current.startMs
          ? Date.now() - thinkingRef.current.startMs
          : 0);
      const capturedGenerationMs = Math.max(
        endMs - (timing.firstTokenMs ?? endMs),
        0
      );
      const sessionTotals = sessionStatsRef.current;
      const estimatedTurnOutputTokens = estimateTokenCount(
        capturedThinking + capturedContent
      );
      const turnUsage = result.usage;
      const turnInputTokens = turnUsage?.inputTokens;
      const turnOutputTokens =
        turnUsage?.outputTokens ?? estimatedTurnOutputTokens;
      const turnCachedTokens = turnUsage?.cachedTokens;
      const turnCost = turnUsage?.cost;
      const nextTotalOutputTokens =
        sessionTotals.outputTokens + turnOutputTokens;
      const nextGenerationMs =
        sessionTotals.generationMs + capturedGenerationMs;
      const nextAverageTokensPerSecond = getAverageTokensPerSecond(
        nextTotalOutputTokens,
        nextGenerationMs
      );
      clearInterval(flushInterval);
      streamingBufferRef.current = '';
      thinkingRef.current = { buffer: '', startMs: 0, durationMs: null };

      startTransition(() => {
        setStreamingContent('');
        setStreamingThinking('');
        setThinkingDuration(null);
        setConversation(result.conversation);
        setStatus('Ready');
        if (thinkingAnchor && capturedThinking) {
          setMessageThinking((prev) => ({
            ...prev,
            [thinkingAnchor.id]: {
              content: capturedThinking,
              durationMs: capturedDuration,
            },
          }));
        }
        if (timing.firstTokenMs !== null) {
          const ttftMs = timing.firstTokenMs - timing.startMs;
          const genSeconds = Math.max(capturedGenerationMs, 1) / 1000;
          setLastStats({
            ttftMs,
            tokensPerSecond: turnOutputTokens / genSeconds,
            avgTokensPerSecond: nextAverageTokensPerSecond,
          });
          sessionStatsRef.current = {
            outputTokens: nextTotalOutputTokens,
            generationMs: nextGenerationMs,
          };
        }
        if (turnUsage || turnInputTokens !== undefined) {
          const u = turnUsage ?? {
            inputTokens: turnInputTokens ?? 0,
            outputTokens: turnOutputTokens,
            cachedTokens: turnCachedTokens ?? 0,
          };
          const pricing = activeModelInfo?.pricing;
          const requestCost =
            turnCost ??
            (pricing
              ? u.inputTokens * pricing.inputPerToken +
                u.outputTokens * pricing.outputPerToken +
                u.cachedTokens *
                  (pricing.cacheReadPerToken ?? pricing.inputPerToken)
              : 0);
          setMetrics((prev) => ({
            inputTokens: prev.inputTokens + u.inputTokens,
            outputTokens: prev.outputTokens + u.outputTokens,
            cachedTokens: prev.cachedTokens + u.cachedTokens,
            cost: prev.cost + requestCost,
            lastInputTokens: u.inputTokens,
          }));
        } else {
          setMetrics((prev) => ({
            inputTokens: prev.inputTokens,
            outputTokens: prev.outputTokens + turnOutputTokens,
            cachedTokens: prev.cachedTokens,
            cost: prev.cost,
            lastInputTokens: prev.lastInputTokens,
          }));
        }
      });
    } catch (caughtError: unknown) {
      clearInterval(flushInterval);
      setPendingApproval(null);

      if (isAbortError(caughtError)) {
        const capturedThinking = thinkingRef.current.buffer;
        const capturedContent = streamingBufferRef.current;
        const capturedDuration =
          thinkingRef.current.durationMs ??
          (thinkingRef.current.startMs
            ? Date.now() - thinkingRef.current.startMs
            : 0);

        const interruptedMessage =
          capturedThinking || capturedContent
            ? createMessage(
                'assistant',
                capturedContent,
                new Date(),
                undefined,
                capturedThinking
                  ? {
                      thinking: {
                        content: capturedThinking,
                        durationMs: capturedDuration,
                      },
                    }
                  : undefined
              )
            : null;

        setConversation((current) => {
          if (!current) return current;
          // Settle any optimistic bash placeholder still marked running, then
          // append whatever partial assistant response was captured.
          const messages = current.messages.map((message) =>
            message.role === 'tool' &&
            message.name === 'bash' &&
            message.content === ''
              ? { ...message, content: 'Command was cancelled.' }
              : message
          );
          return {
            ...current,
            messages: interruptedMessage
              ? [...messages, interruptedMessage]
              : messages,
          };
        });

        streamingBufferRef.current = '';
        thinkingRef.current = { buffer: '', startMs: 0, durationMs: null };
        setStreamingContent('');
        setStreamingThinking('');
        setThinkingDuration(null);
        setError(null);
        setStatus('Interrupted');
        // Put the interrupted prompt back so the user can tweak and resend.
        interruptedPromptRef.current = submittedPromptRef.current || null;
      } else {
        streamingBufferRef.current = '';
        thinkingRef.current = { buffer: '', startMs: 0, durationMs: null };
        setStreamingContent('');
        setStreamingThinking('');
        setThinkingDuration(null);
        setError(getErrorMessage(caughtError));
        setStatus('Request failed');
      }
    } finally {
      // The live tool boxes are only an in-flight indicator; once the turn is
      // done the finished conversation renders every tool call inline, in order.
      setToolEvents([]);
      liveBashCallRef.current = null;
      setIsSending(false);
      activeRequestControllerRef.current = null;
    }
  };

  if (showModelPicker) {
    return (
      <ModelPicker
        models={connectModels ?? allModels}
        currentModel={activeModel}
        onSelect={handleModelSelect}
        onCancel={() => {
          setShowModelPicker(false);
          setConnectModels(null);
          // Cancelling the post-connect picker keeps the highlighted default and
          // starts the session, so the connect flow still lands somewhere usable.
          if (!session && activeModel) {
            loadSession(currentSessionId, activeModel);
          }
        }}
      />
    );
  }

  if (showSessionPicker) {
    return (
      <SessionPicker
        sessions={sessionSummaries}
        currentSessionId={currentSessionId}
        loading={sessionSummariesLoading}
        onSelect={(sessionId) => {
          setShowSessionPicker(false);
          setStatus('Loading session...');
          setCurrentSessionId(sessionId);
        }}
        onCancel={() => {
          setShowSessionPicker(false);
        }}
      />
    );
  }

  if (showConnectPicker) {
    return (
      <ConnectPicker
        activeProviderId={activeProviderId}
        configuredProviderIds={configuredProviderIds}
        configuredProviders={configuredProviders}
        onComplete={(result) => void handleConnectComplete(result)}
        onCancel={() => {
          // Nothing connected yet means there's nothing to fall back to, so
          // cancelling exits rather than dropping into an unusable chat view.
          if (!activeProviderId) {
            exit();
            return;
          }
          setShowConnectPicker(false);
        }}
      />
    );
  }

  return (
    <box
      flexDirection="column"
      height={dimensions.height}
      width={dimensions.width}
      padding={1}
    >
      <box flexDirection="column" flexShrink={0}>
        <text fg="cyan" flexShrink={0}>
          JustCode
        </text>
        <text fg={MUTED} flexShrink={0}>
          Provider: {activeProviderId} | Session: {currentSessionLabel}
        </text>
        <text fg={MUTED} flexShrink={0}>
          Enter to send · Tab to complete @file or /command · Esc to cancel or
          interrupt · Ctrl+C to exit
        </text>
      </box>

      <scrollbox
        ref={scrollRef}
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        marginTop={1}
        stickyScroll
        stickyStart="bottom"
        contentOptions={{ flexDirection: 'column' }}
      >
        {conversation?.messages.length ? (
          conversation.messages.map((message) => {
            const thinking =
              message.role === 'assistant'
                ? (message.thinking ?? messageThinking[message.id])
                : undefined;
            return (
              <box key={message.id} flexDirection="column">
                {thinking ? (
                  <box flexDirection="column" marginBottom={0}>
                    <text fg="yellow">
                      {thinkingCollapsed ? '+ ' : ''}Thought:{' '}
                      {formatDuration(thinking.durationMs)}
                    </text>
                    {thinkingCollapsed ? null : (
                      <text fg={MUTED}>{thinking.content}</text>
                    )}
                  </box>
                ) : null}
                {message.role === 'user' ? (
                  <box
                    flexDirection="column"
                    border={['left']}
                    borderStyle="rounded"
                    borderColor="cyan"
                    paddingLeft={1}
                    marginY={1}
                  >
                    <text fg="white" attributes={BOLD}>
                      {message.content}
                    </text>
                    <text fg={MUTED}>{formatTime(message.createdAt)}</text>
                  </box>
                ) : message.role === 'assistant' ? (
                  <box flexDirection="column">
                    {message.content &&
                    !(thinking && message.toolCalls?.length) ? (
                      <MarkdownView content={message.content} />
                    ) : null}
                    {/* bash calls are shown by their result box below, so skip
                        them here to avoid a redundant ⚙ line. */}
                    {message.toolCalls
                      ?.filter((call) => call.name !== 'bash')
                      .map((call) => (
                        <text key={call.id} fg="magenta">
                          ⚙ {call.name}({summarizeToolArgs(call.arguments)})
                        </text>
                      ))}
                  </box>
                ) : message.role === 'tool' ? (
                  message.name === 'bash' ? (
                    // When /expand-tools is off, inline stays a one-line summary
                    // (the box opens in a pinned panel via browsing); when on,
                    // every command shows its full input/output inline.
                    <BashResult
                      command={bashCommandFromArgs(
                        message.toolCallId
                          ? bashCommandByCallId.get(message.toolCallId)
                          : undefined
                      )}
                      output={message.content}
                      expanded={expandTools}
                      selected={message.id === selectedBashId}
                    />
                  ) : (
                    <text fg={MUTED}>
                      {'  ↳ '}
                      {firstLine(message.content)}
                    </text>
                  )
                ) : (
                  <text
                    content={
                      new StyledText([
                        tc(message.role, { fg: 'yellow' }),
                        tc(`: ${message.content}`),
                      ])
                    }
                  />
                )}
                {message.attachments?.map((attachment) => (
                  <text key={`${message.id}:${attachment.path}`} fg={MUTED}>
                    attached: @{attachment.path}
                  </text>
                ))}
              </box>
            );
          })
        ) : (
          <text fg={MUTED}>No messages yet.</text>
        )}
        {streamingThinking || streamingContent ? (
          <box flexDirection="column">
            {streamingThinking ? (
              <box flexDirection="column">
                <text fg="yellow">
                  {thinkingDuration !== null
                    ? `${thinkingCollapsed ? '+ ' : ''}Thought: ${formatDuration(thinkingDuration)}`
                    : 'thinking...'}
                </text>
                {thinkingCollapsed ? null : (
                  <text fg={MUTED}>{streamingThinking}</text>
                )}
              </box>
            ) : null}
            {streamingContent ? (
              <MarkdownView content={streamingContent} streaming />
            ) : null}
          </box>
        ) : null}
        {toolEvents.length ? (
          <box flexDirection="column" marginTop={1}>
            {toolEvents.map((event) => (
              <box key={event.key} flexDirection="column">
                <text
                  fg={
                    event.status === 'error'
                      ? 'red'
                      : event.status === 'done'
                        ? 'green'
                        : 'yellow'
                  }
                >
                  {event.status === 'running'
                    ? '⚙ '
                    : event.status === 'done'
                      ? '✓ '
                      : '✗ '}
                  {event.title}
                </text>
                {event.diff ? (
                  <box marginLeft={2}>
                    <text content={ansiToStyledText(event.diff)} />
                  </box>
                ) : null}
              </box>
            ))}
          </box>
        ) : null}
        {pendingApproval ? (
          <box
            flexDirection="column"
            marginTop={1}
            border
            borderStyle="rounded"
            borderColor="yellow"
            paddingX={1}
          >
            <text fg="yellow" attributes={BOLD}>
              Run {pendingApproval.request.toolName}?
            </text>
            <text>{pendingApproval.request.title}</text>
            {pendingApproval.request.diff ? (
              <box marginTop={1} marginLeft={1}>
                <text
                  content={ansiToStyledText(
                    renderDiff(pendingApproval.request.diff)
                  )}
                />
              </box>
            ) : pendingApproval.request.preview ? (
              <box marginTop={1}>
                <text fg={MUTED}>
                  {truncatePreview(pendingApproval.request.preview)}
                </text>
              </box>
            ) : null}
            <box marginTop={1}>
              <text
                content={
                  new StyledText([
                    tc('[y]', { fg: 'green' }),
                    tc('es  '),
                    tc('[a]', { fg: 'cyan' }),
                    tc('lways  '),
                    tc('[n]', { fg: 'red' }),
                    tc('o'),
                  ])
                }
              />
            </box>
          </box>
        ) : null}
      </scrollbox>

      <box flexDirection="column" flexShrink={0}>
        {isCommandMode ? (
          <box
            marginTop={1}
            flexDirection="column"
            flexShrink={0}
            border
            borderStyle="single"
            borderColor={visibleCommands.length ? 'cyan' : 'yellow'}
            paddingX={1}
          >
            <text fg={MUTED}>commands</text>
            {visibleCommands.length === 0 ? (
              <text fg="yellow">/{commandQuery} doesn&apos;t exist</text>
            ) : null}
            {visibleCommands.map((cmd, index) => (
              <box key={cmd.name} flexShrink={0}>
                <text
                  content={commandLineContent(
                    cmd,
                    index === selectedCommandIndex,
                    {
                      thinkingCollapsed,
                      autoApplyWrites,
                      expandTools,
                      maxReadLines,
                    }
                  )}
                />
              </box>
            ))}
          </box>
        ) : null}

        {/* The expanded command opens here, pinned above the prompt, so it's
          always visible without scrolling up to where it sits in the transcript. */}
        {selectedBashMessage && expandedBashIds.has(selectedBashMessage.id) ? (
          <box marginTop={1} flexDirection="column">
            <text fg={MUTED}>
              command {(browseIndex ?? 0) + 1} of {bashToolMessages.length}
            </text>
            <BashResult
              command={bashCommandFromArgs(
                selectedBashMessage.toolCallId
                  ? bashCommandByCallId.get(selectedBashMessage.toolCallId)
                  : undefined
              )}
              output={selectedBashMessage.content}
              expanded
              selected
            />
          </box>
        ) : null}

        {browseIndex !== null ? (
          <box marginTop={1}>
            <text fg={MUTED}>
              browsing commands · ↑/↓ select · enter show/hide output · esc back
              to prompt
            </text>
          </box>
        ) : bashToolMessages.length > 0 &&
          !input &&
          !isSending &&
          !expandTools ? (
          <box marginTop={1}>
            <text fg={MUTED}>
              ↑ to browse {bashToolMessages.length} command output(s)
            </text>
          </box>
        ) : null}

        <box
          marginTop={1}
          width="100%"
          paddingX={1}
          paddingY={1}
          backgroundColor={INPUT_BG}
        >
          <textarea
            key={inputKey}
            initialValue={input}
            width="100%"
            minHeight={3}
            maxHeight={6}
            wrapMode="word"
            placeholder="Ask anything..."
            backgroundColor={INPUT_BG}
            textColor="#111111"
            focusedTextColor="#111111"
            cursorColor="white"
            focused={terminalFocused && !isSending && browseIndex === null}
            onSubmit={() => {
              void submit(promptAreaRef.current?.plainText ?? input);
            }}
            onKeyDown={(event) => {
              const promptArea = promptAreaRef.current;
              if (!promptArea || promptArea.isDestroyed) return;

              if (
                event.name === 'return' ||
                event.name === 'kpenter' ||
                event.name === 'linefeed'
              ) {
                event.preventDefault();
                // Any *modified* Enter inserts a newline; only a bare,
                // unmodified Enter submits. Terminals disagree on which
                // modifier they attach to Ctrl/Shift/Cmd+Enter (e.g. some
                // report Ctrl+Enter as the Kitty `super` modifier, Shift+Enter
                // as `meta`), so we treat "Enter + any modifier" as a newline.
                if (
                  event.shift ||
                  event.ctrl ||
                  event.meta ||
                  event.option ||
                  event.super ||
                  event.hyper
                ) {
                  promptArea.insertText('\n');
                  return;
                }

                void submit(promptArea.plainText);
              }
            }}
            onContentChange={() => {
              const promptArea = promptAreaRef.current;
              if (!promptArea || promptArea.isDestroyed) return;
              setInput(promptArea.plainText);
            }}
            ref={(next) => {
              promptAreaRef.current = next;
            }}
          />
        </box>

        {!isCommandMode && showMentionSuggestions ? (
          <box marginTop={1} flexDirection="column">
            <text fg={MUTED}>file suggestions:</text>
            {mentionSuggestions.map((suggestion, index) => (
              <text
                key={suggestion}
                {...(index === selectedSuggestionIndex ? { fg: 'cyan' } : {})}
              >
                {index === selectedSuggestionIndex ? '>' : ' '} @{suggestion}
              </text>
            ))}
            {noMentionMatches ? <text fg={MUTED}>no file found</text> : null}
          </box>
        ) : null}

        <box marginTop={1} flexDirection="row" justifyContent="space-between">
          {/* flexShrink={0} stops yoga from compressing this row and wrapping the
            model name mid-word during the transition back from the picker. */}
          <box flexDirection="row" flexShrink={0}>
            {isSending ? <Spinner fg="yellow" /> : null}
            {isSending ? <text> </text> : null}
            <text fg="cyan" attributes={BOLD} wrapMode="none">
              {`${activeModelInfo?.providerId ?? props.providerId ?? ''}/${
                activeModel || session?.activeModel || 'loading'
              }`}
            </text>
            {showInterruptHint ? (
              <text fg={MUTED}> · Press Esc to interrupt</text>
            ) : null}
          </box>
        </box>
        <box marginTop={1}>
          <text content={metricsLineContent(metrics, activeModelInfo)} />
        </box>
        <box marginTop={1} flexDirection="row" justifyContent="flex-end">
          {displayStats ? (
            <text
              content={
                new StyledText([
                  tc(`TTFT ${formatDuration(displayStats.ttftMs)} · `, {
                    fg: MUTED,
                  }),
                  tc(displayStats.tokensPerSecond.toFixed(1), { fg: 'white' }),
                  tc(' tok/s · AVG ', { fg: MUTED }),
                  tc(displayStats.avgTokensPerSecond.toFixed(1), {
                    fg: 'white',
                  }),
                ])
              }
            />
          ) : (
            <text content={statusLineContent(status)} />
          )}
        </box>
        {error ? (
          <box marginTop={1}>
            <text fg="red">Error: {error}</text>
          </box>
        ) : null}
      </box>

      {copiedNotice ? (
        <box
          position="absolute"
          bottom={1}
          right={2}
          paddingX={1}
          backgroundColor="#1f6f43"
        >
          <text fg="white">✓ Copied</text>
        </box>
      ) : null}
    </box>
  );
}

/**
 * Inline rendering of a finished bash call in the transcript: a one-line
 * summary that, when expanded, opens a box with the command and its output
 * split by a horizontal rule. Selection (while browsing) tints it cyan.
 */
function BashResult({
  command,
  output,
  expanded,
  selected,
}: {
  command: string;
  output: string;
  expanded: boolean;
  selected: boolean;
}): React.ReactNode {
  // Empty output means the call is still running (a finished call always has
  // non-empty content). Running calls always show the box so it's visible
  // in place; finished calls show it only when expanded.
  const running = output === '';
  const error = !running && isBashErrorOutput(output);
  const summary = firstLine(command || output);
  const showBox = running || expanded;
  const color = selected
    ? 'cyan'
    : running
      ? 'yellow'
      : error
        ? 'red'
        : 'green';
  return (
    <box flexDirection="column">
      <text
        content={
          new StyledText([
            tc(
              `${selected ? '› ' : '  '}${running ? '⚙ ' : error ? '✗ ' : '✓ '}bash: ${summary}`,
              { fg: color }
            ),
            ...(!showBox
              ? [tc(` ${selected ? '(enter to expand)' : '▸'}`, { fg: MUTED })]
              : []),
          ])
        }
      />
      {showBox ? (
        <box
          flexDirection="column"
          marginLeft={2}
          border
          borderStyle="rounded"
          borderColor={selected ? 'cyan' : error ? 'red' : 'gray'}
          paddingX={1}
        >
          <text fg="cyan">$ {command}</text>
          {/* A full-width box with only a top border draws the horizontal rule
              that splits the command from its output. */}
          <box border={['top']} borderStyle="single" borderColor="gray" />
          {running ? (
            <text fg={MUTED}>running…</text>
          ) : (
            <text content={ansiToStyledText(truncatePreview(output))} />
          )}
        </box>
      ) : null}
    </box>
  );
}

function bashCommandFromArgs(rawArguments: string | undefined): string {
  if (!rawArguments) return '';
  try {
    const parsed = JSON.parse(rawArguments) as { command?: unknown };
    return typeof parsed.command === 'string' ? parsed.command : '';
  } catch {
    return '';
  }
}

// Best-effort: the BashTool prefixes failed runs with one of these phrases, so
// we can colour the summary red without threading isError through the message.
function isBashErrorOutput(content: string): boolean {
  return /^(Command failed|Command timed out|Command was cancelled|Failed to run command|Invalid arguments)/.test(
    content
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function getLiveStats(
  timing: { startMs: number; firstTokenMs: number | null },
  outputText: string,
  tick: number,
  sessionTotals: { outputTokens: number; generationMs: number }
): {
  ttftMs: number;
  tokensPerSecond: number;
  avgTokensPerSecond: number;
} | null {
  if (!timing.startMs) {
    return null;
  }

  const now = Date.now();
  const firstTokenMs = timing.firstTokenMs ?? now;
  const ttftMs = Math.max(firstTokenMs - timing.startMs, 0);
  const genElapsedMs = Math.max(now - firstTokenMs, 1);
  const estimatedTokens = estimateTokenCount(outputText);
  const currentTokensPerSecond = estimatedTokens / (genElapsedMs / 1000);
  const avgTokensPerSecond = getAverageTokensPerSecond(
    sessionTotals.outputTokens + estimatedTokens,
    sessionTotals.generationMs + genElapsedMs
  );

  // `tick` is included so the caller can force a rerender on a timer.
  void tick;

  return {
    ttftMs,
    tokensPerSecond: currentTokensPerSecond,
    avgTokensPerSecond,
  };
}

function getAverageTokensPerSecond(
  outputTokens: number,
  generationMs: number
): number {
  if (outputTokens <= 0 || generationMs <= 0) {
    return 0;
  }

  return outputTokens / (generationMs / 1000);
}

function estimateTokenCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }

  return Math.max(1, Math.round(trimmed.length / 4));
}

function summarizeToolArgs(rawArguments: string): string {
  try {
    const parsed = JSON.parse(rawArguments) as Record<string, unknown>;
    if (typeof parsed.path === 'string') return parsed.path;
    const keys = Object.keys(parsed);
    return keys.length ? keys.join(', ') : '';
  } catch {
    return truncate(rawArguments, 40);
  }
}

function firstLine(content: string): string {
  const [line = ''] = content.split('\n');
  return truncate(line, 100);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function truncatePreview(preview: string): string {
  const lines = preview.split('\n');
  if (lines.length <= MAX_PREVIEW_LINES) return preview;
  return [
    ...lines.slice(0, MAX_PREVIEW_LINES),
    `… (${lines.length - MAX_PREVIEW_LINES} more lines)`,
  ].join('\n');
}

function contextPct(inputTokens: number, contextWindow: number): number {
  return Math.round((inputTokens / contextWindow) * 100);
}

function mergeProviders(
  baseProviders: ProviderClient[],
  extraProviders: ProviderClient[]
): ProviderClient[] {
  const byId = new Map<ProviderId, ProviderClient>();

  for (const provider of baseProviders) {
    byId.set(provider.providerId, provider);
  }

  for (const provider of extraProviders) {
    byId.set(provider.providerId, provider);
  }

  return [...byId.values()];
}

function formatTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;

  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    const rounded = Math.round(totalSeconds * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return seconds > 0 ? `${minutes}min ${seconds}s` : `${minutes}min`;
}
