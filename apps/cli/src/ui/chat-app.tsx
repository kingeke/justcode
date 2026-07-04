import React, {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
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
import { copyToClipboard, readClipboardImage } from '@cli/ui/clipboard.js';
import { Spinner } from '@cli/ui/spinner.js';
import { ansiToStyledText } from '@cli/ui/ansi-to-styled-text.js';

import {
  applyMentionSuggestion,
  applySymbolSuggestion,
  filterMentionSuggestions,
  filterSymbolSuggestions,
  getActiveMentionQuery,
  getActiveSymbolMention,
  hasActiveMentionTrigger,
  type PromptAttachmentService,
} from '@core/application/prompt-attachment-service';
import {
  getInterruptedConversation,
  type ChatSessionService,
  type StartSessionResult,
  type ToolActivityEvent,
  type ToolApprovalRequest,
} from '@core/application/chat-session-service';
import type { UserQuestionRequest } from '@core/ports/tool';
import {
  createConversation,
  type Conversation,
  type SessionStats,
} from '@core/domain/conversation';
import type { ManageableToolInfo } from '@core/domain/tool-metadata';
import {
  BUILD_MODE_ID,
  modePlaceholder,
  type ChatMode,
} from '@core/domain/chat-mode';
import { createMessage, type MessageImage } from '@core/domain/message';
import { DEFAULT_SYSTEM_PROMPT } from '@core/application/system-prompt';
import type {
  ModelInfo,
  ModelReasoning,
  ProviderClient,
  ReasoningEffort,
  TokenUsage,
} from '@core/ports/chat-model';
import type { GlobalConfig } from '@runtime/persistence/global-config';
import { mergeProviderConfig } from '@runtime/persistence/global-config';
import { resetAppState } from '@runtime/persistence/reset-app-state';
import { ensureMcpConfigFile } from '@runtime/mcp/mcp-config';
import { clearModelsCache } from '@providers/http/models-cache';
import { renderDiff } from '@cli/ui/render-diff.js';
import { DEFAULT_MAX_READ_LINES } from '@core/application/read-window';
import { DEFAULT_MAX_HISTORY_MESSAGES } from '@core/application/history-window';
import {
  DEFAULT_AUTO_COMPACT_THRESHOLD_PERCENT,
  DEFAULT_EXPECTED_SUMMARY_TOKENS,
  compactProgressPercent,
} from '@core/application/compact-prompt';
import {
  COMMANDS,
  CommandName,
  filterCommands,
  isCommandName,
  parseCommandInput,
} from '@cli/ui/commands.js';
import { formatTime } from '@cli/ui/format-message-timing.js';
import { openFileInEditor } from '@cli/ui/open-file.js';
import { KeyName } from '@cli/ui/key-name.js';
import { prepareMarkdown } from '@cli/ui/markdown.js';
import {
  MARKDOWN_MUTED_SYNTAX_STYLES,
  MARKDOWN_SYNTAX_STYLES,
} from '@cli/ui/markdown-theme.js';
import {
  ConnectPicker,
  type ConnectedProviderResult,
} from '@cli/ui/connect-picker.js';
import { ModelPicker } from '@cli/ui/model-picker.js';
import { ReasoningPicker } from '@cli/ui/reasoning-picker.js';
import { ToolsPicker } from '@cli/ui/tools-picker.js';
import { ModePicker, modeGlyph } from '@cli/ui/mode-picker.js';
import { ResetPicker } from '@cli/ui/reset-picker.js';
import { ClearSessionsPicker } from '@cli/ui/clear-sessions-picker.js';
import { SessionPicker } from '@cli/ui/session-picker.js';
import { ProviderId } from '@core/ports/provider-catalog.js';
import type { ConversationSummary } from '@core/ports/conversation-repository';
import { APP_NAME } from '@core/branding';
import type { UpdateNotice } from '@core/application/update-check';

const MAX_COMMAND_ITEMS = 8;

// Cosmetic placeholder inserted into the prompt for each pasted image (e.g.
// "[Image #1]"), mirroring the actual images held in `pendingImages`. Stripped
// from the prompt text before the message is sent — the images travel as proper
// image blocks, not as this literal text.
const IMAGE_MARKER_PATTERN = /\s*\[Image #\d+\]\s*/g;

// A pasted image staged for the next send, tagged with the stable marker number
// shown in its `[Image #n]` placeholder. The number lets us tell which image a
// given marker refers to even after others are removed, so deleting a marker
// drops the right image.
type PendingImage = MessageImage & { marker: number };

// The set of marker numbers (`[Image #n]`) currently present in `text`.
function markersInText(text: string): Set<number> {
  const numbers = new Set<number>();
  for (const match of text.matchAll(/\[Image #(\d+)\]/g)) {
    numbers.add(Number(match[1]));
  }
  return numbers;
}

const BOLD = createTextAttributes({ bold: true });
// Muted text uses an explicit grey foreground rather than the SGR "dim" attribute:
// dim renders inconsistently (often near-white) across terminals, whereas a grey
// fg reads as reliably subdued — matching the previous Ink look.
const MUTED = '#8a8a8a';

interface ChatAppProps {
  /** Exits the app (tears down the OpenTUI renderer). */
  onExit: () => void;
  /** App version, shown next to the title (e.g. "0.1.0"). */
  version: string;
  /** A newer release, when one is available; drives the update banner. */
  updateNotice?: UpdateNotice | null;
  /** Active provider, or undefined when nothing is connected yet. */
  providerId: ProviderId | undefined;
  savedConfig: GlobalConfig;
  configFilePath: string;
  /** Directory holding the on-disk config, used to locate `mcp.json`. */
  configDirectory: string;
  chatSessionService: ChatSessionService;
  promptAttachmentService: PromptAttachmentService;
  sessionId: string;
  requestedModel: string | undefined;
  allProviders: ProviderClient[];
  createProvider: (id: ProviderId) => ProviderClient;
  onConfigChange: (config: GlobalConfig) => void;
  /**
   * Fully replaces the persisted config (used by reset). Unlike onConfigChange,
   * this does not merge into the prior config, so dropped keys (e.g. connected
   * providers) stay gone instead of being resurrected from stale in-memory state.
   */
  onConfigReset: (config: GlobalConfig) => void;
  /**
   * Reconnects MCP servers from the current `mcp.json`. Called after a reset
   * (which deletes the file) so the live session drops every running MCP server
   * and its tools, matching the now-empty on-disk config without a restart.
   */
  onReloadMcp?: () => Promise<unknown>;
  onModelChange?: (modelId: string, providerId: string) => void;
  initialThinkingCollapsed?: boolean;
  onThinkingCollapsedChange?: (collapsed: boolean) => void;
  initialAutoApprove?: boolean;
  onAutoApproveChange?: (autoApply: boolean) => void;
  initialLocalModelAutoRefresh?: boolean;
  onLocalModelAutoRefreshChange?: (enabled: boolean) => void;
  initialModelAutoRefresh?: boolean;
  onModelAutoRefreshChange?: (enabled: boolean) => void;
  initialLazyToolLoading?: boolean;
  onLazyToolLoadingChange?: (enabled: boolean) => void;
  /** The toggleable tools and their startup state, for the manage-tools modal. */
  manageableTools?: ManageableToolInfo[];
  /** Names of tools turned off at startup. */
  initialDisabledTools?: string[];
  /** Persist (and apply) a new disabled-tools set. */
  onDisabledToolsChange?: (names: string[]) => void;
  initialExpandTools?: boolean;
  onExpandToolsChange?: (expand: boolean) => void;
  /** The available chat modes (built-in + custom), in display order. */
  modes?: ChatMode[];
  /** Id of the mode active at startup. */
  initialMode?: string;
  /**
   * Switch the active mode: the host swaps the runtime's system prompt and
   * persists the choice. Called with the new mode id (e.g. on shift+tab).
   */
  onModeChange?: (modeId: string) => void;
  /**
   * Create a custom mode (name + optional system prompt). The host persists it
   * and makes it active, returning the updated mode list and the new mode's id
   * so the picker reflects it immediately.
   */
  onCreateMode?: (
    name: string,
    systemPrompt?: string
  ) => { modes: ChatMode[]; modeId: string } | null;
  initialMaxReadLines?: number;
  onMaxReadLinesChange?: (lines: number) => void;
  initialMaxHistoryMessages?: number;
  onMaxHistoryMessagesChange?: (count: number) => void;
  /** Auto-compact threshold percent at startup (0 = off). */
  initialAutoCompactThresholdPercent?: number;
  /** Persist a new auto-compact threshold (0 = off). */
  onAutoCompactThresholdChange?: (percent: number) => void;
  initialReasoningEffortByModel?: Record<
    string,
    Record<string, ReasoningEffort | 'off' | undefined> | undefined
  >;
  onReasoningEffortChange?: (
    providerId: string,
    modelId: string,
    effort: ReasoningEffort | 'off'
  ) => void;
}

interface PendingApproval {
  request: ToolApprovalRequest;
  resolve: (approved: boolean) => void;
}

interface PendingQuestion {
  request: UserQuestionRequest;
  resolve: (answer: string) => void;
}

const MAX_PREVIEW_LINES = 16;
// How many percentage points below the auto-compact threshold the "context
// almost full" warning starts flashing after a turn.
const AUTO_COMPACT_WARN_MARGIN = 5;
const EXIT_HINT = 'Press Ctrl+C again to exit';
const EXIT_WINDOW_MS = 2000;
const MARKDOWN_FG = '#d4d4d4';
// Background of the clickable jump-to-top/bottom pills over the transcript.
const INPUT_BG = '#008B8B';
// Border of the prompt input: dim enough to read as chrome, not content.
const INPUT_BORDER = '#565b65';
// App background: keeps the light-on-dark UI readable on light/white terminals.
// The renderer also sets this as the global clear color; the root box repaints
// it so the main view is covered even if the native clear is unavailable.
const APP_BG = '#24272D';

// One shared SyntaxStyle for all markdown rendering. Created lazily on first use
// (after the native renderer is initialised) so it isn't constructed at import
// time. Built from an explicit style map — a bare SyntaxStyle.create() registers
// no styles, so every chunk resolves to the default and renders as unstyled raw
// text; fromStyles is what makes headings, bold, code, links, etc. actually style.
let sharedSyntaxStyle: SyntaxStyle | null = null;
function getSyntaxStyle(): SyntaxStyle {
  if (!sharedSyntaxStyle) {
    sharedSyntaxStyle = SyntaxStyle.fromStyles(MARKDOWN_SYNTAX_STYLES);
  }
  return sharedSyntaxStyle;
}

/**
 * Once the live streaming block grows past this many characters, everything up
 * to its last safe paragraph boundary is committed inline (as an optimistic
 * assistant message) so only the small tail keeps re-rendering. Re-laying-out
 * an ever-growing markdown block on every flush is what reads as transcript
 * flicker on long answers.
 */
const LIVE_BLOCK_COMMIT_CHARS = 2000;

/**
 * The last safe point to split a streamed markdown buffer: a paragraph
 * boundary (`\n\n`) that isn't inside an open code fence, so a fence spanning
 * paragraphs is never torn across two renders. Returns the index just past the
 * boundary, or null when no safe boundary exists yet.
 */
function safeStreamCommitPoint(buffer: string): number | null {
  let boundary = buffer.lastIndexOf('\n\n');
  while (boundary > 0) {
    const fences =
      buffer.slice(0, boundary).match(/^\s*(```|~~~)/gm)?.length ?? 0;
    if (fences % 2 === 0) return boundary + 2;
    boundary = buffer.lastIndexOf('\n\n', boundary - 1);
  }
  return null;
}

// A dimmed SyntaxStyle for reasoning/thinking, so it renders formatted but in a
// uniform muted gray that reads as distinct from the model's answer.
let mutedSyntaxStyle: SyntaxStyle | null = null;
function getMutedSyntaxStyle(): SyntaxStyle {
  if (!mutedSyntaxStyle) {
    mutedSyntaxStyle = SyntaxStyle.fromStyles(MARKDOWN_MUTED_SYNTAX_STYLES);
  }
  return mutedSyntaxStyle;
}

// Renders raw markdown with OpenTUI's native <markdown> renderable, which lays out
// tables, headings, lists and code blocks correctly inside the TUI (the previous
// marked-terminal → ANSI pipeline mangled tables). Mirrors opencode's approach.
// Memoized so a committed message's markdown isn't re-parsed (marked + shiki) on
// every streaming tick or keystroke — only when its own `content` changes. This
// is the main lever against the transcript flicker: without it, every message in
// the conversation re-lays-out ~20×/sec while a response streams, which the
// renderer overdraws.
const MarkdownView = React.memo(function MarkdownView({
  content,
  live = false,
  muted = false,
}: {
  content: string;
  /** True for the in-flight streaming block, false for a committed message. */
  live?: boolean;
  /** Render dimmed (for reasoning/thinking) so it reads distinct from answers. */
  muted?: boolean;
}): React.ReactNode {
  // Committed messages render with `streaming` off so OpenTUI uses the
  // tree-sitter highlighter, which both styles the markdown and conceals its
  // markers (`#`, `**`, `` ` ``) — the clean look. The in-flight block renders
  // with `streaming` on for incremental parsing as tokens arrive (markers show
  // until it commits, then it re-renders concealed). Both depend on a populated
  // SyntaxStyle; see getSyntaxStyle.
  //
  // A committed message that wrapped its whole answer in a code fence, or left a
  // fence unterminated, would otherwise render as literal text, so normalise it
  // first. The live block is left as-is — a fence is expected to be temporarily
  // open as the block streams in.
  const prepared = live ? content : prepareMarkdown(content);
  return (
    <markdown
      content={prepared}
      syntaxStyle={muted ? getMutedSyntaxStyle() : getSyntaxStyle()}
      streaming={live}
      tableOptions={{ style: 'grid' }}
      fg={muted ? MUTED : MARKDOWN_FG}
      flexShrink={0}
    />
  );
});

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

/**
 * The reasoning effort actually sent for a model. The stored choice may be a
 * level, the explicit sentinel `'off'`, or absent (the user hasn't chosen). A
 * reasoning model with no stored choice falls back to its default effort; only
 * an explicit `'off'` disables reasoning.
 */
function effectiveEffort(
  reasoning: ModelReasoning | undefined,
  stored: ReasoningEffort | 'off' | undefined
): ReasoningEffort | 'off' | undefined {
  if (!reasoning) return undefined;
  // A mandatory model always reasons, so a stale "off" (no longer offered by the
  // picker) can't disable it — fall back to the default effort instead.
  if (stored && !(reasoning.mandatory && stored === 'off')) return stored;
  return reasoning.defaultEffort ?? reasoning.effortLevels[0];
}

function commandLineContent(
  cmd: (typeof COMMANDS)[number],
  isSelected: boolean,
  state: {
    thinkingCollapsed: boolean;
    autoApprove: boolean;
    localModelAutoRefresh: boolean;
    modelAutoRefresh: boolean;
    lazyToolLoading: boolean;
    expandTools: boolean;
    maxReadLines: number;
    maxHistoryMessages: number;
    autoCompactThresholdPercent: number;
    reasoning: {
      supported: boolean;
      effort: ReasoningEffort | 'off' | undefined;
    };
  }
): StyledText {
  const lead = isSelected ? { fg: 'cyan' } : {};
  const chunks: TextChunk[] = [
    tc(isSelected ? '› ' : '  ', lead),
    tc(`/${cmd.name}`, { ...lead, bold: isSelected }),
    tc('  ', lead),
  ];
  const description =
    cmd.name === CommandName.Thinking
      ? state.thinkingCollapsed
        ? 'Expand thinking'
        : 'Collapse thinking'
      : cmd.description;
  chunks.push(tc(description, { fg: MUTED }));

  if (cmd.name === CommandName.AutoApprove) {
    chunks.push(
      tc('  '),
      tc(`[${state.autoApprove ? 'on' : 'off'}]`, {
        fg: state.autoApprove ? 'green' : 'yellow',
      })
    );
  } else if (cmd.name === CommandName.LocalRefresh) {
    chunks.push(
      tc('  '),
      tc(`[${state.localModelAutoRefresh ? 'on' : 'off'}]`, {
        fg: state.localModelAutoRefresh ? 'green' : 'yellow',
      })
    );
  } else if (cmd.name === CommandName.ModelAutoRefresh) {
    chunks.push(
      tc('  '),
      tc(`[${state.modelAutoRefresh ? 'on' : 'off'}]`, {
        fg: state.modelAutoRefresh ? 'green' : 'yellow',
      })
    );
  } else if (cmd.name === CommandName.LazyToolLoading) {
    chunks.push(
      tc('  '),
      tc(`[${state.lazyToolLoading ? 'on' : 'off'}]`, {
        fg: state.lazyToolLoading ? 'green' : 'yellow',
      })
    );
  } else if (cmd.name === CommandName.ExpandTools) {
    chunks.push(
      tc('  '),
      tc(`[${state.expandTools ? 'on' : 'off'}]`, {
        fg: state.expandTools ? 'green' : 'yellow',
      })
    );
  } else if (cmd.name === CommandName.ReadLimit) {
    chunks.push(tc('  '), tc(`[${state.maxReadLines} lines]`, { fg: 'green' }));
  } else if (cmd.name === CommandName.ContextWindow) {
    chunks.push(
      tc('  '),
      state.maxHistoryMessages > 0
        ? tc(`[${state.maxHistoryMessages} items]`, { fg: 'green' })
        : tc('[off]', { fg: 'yellow' })
    );
  } else if (cmd.name === CommandName.AutoCompact) {
    chunks.push(
      tc('  '),
      state.autoCompactThresholdPercent > 0
        ? tc(`[${state.autoCompactThresholdPercent}%]`, { fg: 'green' })
        : tc('[off]', { fg: 'yellow' })
    );
  } else if (cmd.name === CommandName.Reasoning) {
    chunks.push(
      tc('  '),
      state.reasoning.supported
        ? tc(`[${state.reasoning.effort ?? 'off'}]`, { fg: 'green' })
        : tc('[n/a]', { fg: MUTED })
    );
  }

  return new StyledText(chunks);
}

function metricsLineContent(
  metrics: ReturnType<typeof getInitialMetrics>,
  activeModelInfo: ModelInfo | null
): StyledText {
  // "ctx" is the size of the *current* context — the input tokens of the most
  // recent request — while "in" is the session's cumulative input-token total.
  // ctx(%) tracks the same number as the "ctx" readout beside it, so the two
  // can never disagree.
  const pct =
    activeModelInfo?.contextWindow == null
      ? null
      : contextPct(metrics.lastInputTokens, activeModelInfo.contextWindow);

  const chunks: TextChunk[] = [
    tc('ctx ', { fg: MUTED }),
    tc(metrics.lastInputTokens.toLocaleString(), { fg: 'white' }),
    tc(' in ', { fg: MUTED }),
    tc(metrics.inputTokens.toLocaleString(), { fg: 'white' }),
    tc(' cached ', { fg: MUTED }),
    tc(metrics.cachedTokens.toLocaleString(), { fg: 'white' }),
    tc(' out ', { fg: MUTED }),
    tc(metrics.outputTokens.toLocaleString(), { fg: 'white' }),
  ];

  if (pct != null) {
    chunks.push(
      tc(' ctx(%) ', { fg: MUTED }),
      tc(`${pct}%`, { fg: contextUsageColor(pct) })
    );
  }

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

type SessionMetrics = ReturnType<typeof getInitialMetrics>;

interface TurnStats {
  ttftMs: number;
  tokensPerSecond: number;
  avgTokensPerSecond: number;
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
  const scrollToTop = useCallback((): void => {
    const scroll = scrollRef.current;
    if (scroll && !scroll.isDestroyed) {
      scroll.scrollTo(0);
    }
  }, []);
  // No provider connected yet: open straight into the connect screen and hold
  // off on starting a session until the user picks one.
  const needsConnect = props.providerId === undefined;
  const [showConnectPicker, setShowConnectPicker] = useState(needsConnect);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showResetPicker, setShowResetPicker] = useState(false);
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  // Sessions queued for the /clear-sessions confirmation: the ids to delete are
  // stashed in a ref while the picker shows their count.
  const [showClearSessionsPicker, setShowClearSessionsPicker] = useState(false);
  const [sessionsToDeleteCount, setSessionsToDeleteCount] = useState(0);
  const sessionsToDeleteRef = useRef<string[]>([]);
  // When the model picker is opened right after connecting, it shows only the
  // freshly connected provider's models (allModels hasn't refreshed yet).
  const [connectModels, setConnectModels] = useState<ModelInfo[] | null>(null);
  const [sessionSummaries, setSessionSummaries] = useState<
    ConversationSummary[]
  >([]);
  const [sessionSummariesLoading, setSessionSummariesLoading] = useState(false);
  const [allModels, setAllModels] = useState<ModelInfo[]>([]);
  // Bumped by /refresh-models to force the model-list effect to re-fetch after
  // the on-disk cache has been cleared.
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
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
  const [lastStats, setLastStats] = useState<TurnStats | null>(null);
  // Mirror `metrics`/`lastStats` in refs so the end-of-turn stats persist can
  // read current values synchronously instead of waiting for a React commit.
  // Always write them through updateMetrics/updateLastStats.
  const metricsRef = useRef<SessionMetrics>(getInitialMetrics());
  const lastStatsRef = useRef<TurnStats | null>(null);
  const updateMetrics = (
    updater: (prev: SessionMetrics) => SessionMetrics
  ): void => {
    metricsRef.current = updater(metricsRef.current);
    setMetrics(metricsRef.current);
  };
  const updateLastStats = (value: TurnStats | null): void => {
    lastStatsRef.current = value;
    setLastStats(value);
  };
  // The session tok/s average, maintained incrementally per completed turn:
  // avg += (sample − avg) / count. Equal weight per turn, no re-averaging.
  const tokensPerSecondAvgRef = useRef({ avg: 0, count: 0 });
  const responseTimingRef = useRef<{
    startMs: number;
    firstTokenMs: number | null;
  }>({ startMs: 0, firstTokenMs: null });
  // Cumulative characters streamed this turn (thinking + answer, across every
  // step). Counted here rather than measured from the visible buffers because
  // those get flushed/cleared mid-turn (thinking commits when the answer starts,
  // prose commits when a tool runs), which would otherwise collapse the live
  // tok/s reading. Reset at each turn start.
  const turnOutputCharsRef = useRef(0);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [input, setInput] = useState('');
  // Mirror of `input` for callbacks that run on a later tick (e.g. the
  // deferred image-marker insert) and must read the current text, not the
  // value captured when the callback was created.
  const inputRef = useRef('');
  inputRef.current = input;
  // Images pasted into the prompt, awaiting the next send. Each carries a stable
  // `marker` number matching its `[Image #n]` marker in the prompt text (see
  // IMAGE_MARKER_PATTERN). Deleting a marker from the prompt drops its image
  // (see reconcilePendingImages).
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const pendingImagesRef = useRef<PendingImage[]>([]);
  pendingImagesRef.current = pendingImages;
  // Bumping this remounts the text input so its cursor jumps to the end after
  // we replace the value programmatically (tab-completion); ink-text-input
  // otherwise keeps its own cursor offset.
  const [inputKey, setInputKey] = useState(0);
  const promptAreaRef = useRef<TextareaRenderable | null>(null);
  // Set when the latest `input` change came from the textarea's own typing
  // (onContentChange) rather than a programmatic set. The sync effect consumes
  // it to skip writing that value back into the live buffer — under fast typing
  // React state lags the buffer, so writing it back would corrupt/reorder text.
  const inputFromAreaRef = useRef(false);

  const setInputWithCursorAtEnd = useCallback((next: string): void => {
    setInput(next);
    // Position the cursor at the end on the live textarea. Remounting (bumping
    // inputKey) re-seeds the value but leaves a fresh OpenTUI textarea's cursor
    // at offset 0, so update it imperatively when the area is mounted and only
    // fall back to a remount when it isn't.
    const area = promptAreaRef.current;
    if (area && !area.isDestroyed) {
      area.setText(next);
      area.cursorOffset = next.length;
    } else {
      setInputKey((key) => key + 1);
    }
  }, []);
  // Pull an image off the OS clipboard (if any) and stage it for the next send,
  // dropping a `[Image #n]` marker into the prompt so the user sees it's been
  // attached. Returns true when an image was found and attached.
  const attachClipboardImage = useCallback((): boolean => {
    const image = readClipboardImage();
    if (!image) return false;

    // Marker numbers are monotonic, not positional: reuse the next number above
    // the highest still staged so a marker can never collide with an existing
    // one after earlier images have been deleted.
    const highest = pendingImagesRef.current.reduce(
      (max, img) => Math.max(max, img.marker),
      0
    );
    const count = highest + 1;
    const marker = `[Image #${count}]`;
    setPendingImages((prev) => [...prev, { ...image, marker: count }]);

    // Defer the buffer mutation out of the paste event: inserting into the
    // textarea while it is still mid-paste leaves its layout and cursor stale
    // (the cursor renders outside the input box until a key press forces a
    // re-measure). On the next tick, re-seed the whole buffer with the marker
    // appended and the cursor at the end — the same full-set path every other
    // programmatic input change (clear, tab-complete, restore) goes through.
    setTimeout(() => {
      const area = promptAreaRef.current;
      const existing =
        area && !area.isDestroyed ? area.plainText : inputRef.current;
      const lead = existing.length > 0 && !existing.endsWith(' ') ? ' ' : '';
      setInputWithCursorAtEnd(`${existing}${lead}${marker} `);
    }, 0);

    setStatus(`Image #${count} attached — send your message to include it`);
    return true;
  }, [setInputWithCursorAtEnd]);

  // Drop any staged image whose `[Image #n]` marker the user has since deleted
  // from the prompt. Called on every prompt edit so the images sent always match
  // the markers the user can see.
  const reconcilePendingImages = useCallback((text: string): void => {
    if (pendingImagesRef.current.length === 0) return;
    const present = markersInText(text);
    if (pendingImagesRef.current.every((img) => present.has(img.marker))) {
      return;
    }
    setPendingImages((prev) => prev.filter((img) => present.has(img.marker)));
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
    setPendingQuestion((current) => {
      current?.resolve('');
      return null;
    });
    setIsSending(false);
    setQueuedMessages([]);
    setQueueEditIndex(null);
    setPendingImages([]);
    setConversation(null);
    autoCompactWarnedMilestoneRef.current = null;
    setError(null);
    updateLastStats(null);
    updateMetrics(() => getInitialMetrics());
    setStreamingContent('');
    setStreamingThinking('');
    setThinkingDuration(null);
    setLiveToolDiffs({});
    setMessageThinking({});
    streamingBufferRef.current = '';
    contentFlushRef.current = { length: 0, atMs: 0 };
    thinkingRef.current = { buffer: '', startMs: 0, durationMs: null };
    thinkingSegmentsRef.current = [];
    responseTimingRef.current = { startMs: 0, firstTokenMs: null };
    turnOutputCharsRef.current = 0;
    tokensPerSecondAvgRef.current = { avg: 0, count: 0 };
  };
  const [status, setStatus] = useState<string>('Loading session...');
  const [isSending, setIsSending] = useState(false);
  const [activityTick, setActivityTick] = useState(0);
  const [streamingContent, setStreamingContent] = useState<string>('');
  const streamingBufferRef = useRef('');
  // Throttle state for the live markdown block: how much of the buffer we've
  // already pushed to <MarkdownView>, and when. We only re-render the streaming
  // tail on a completed line (a newline arrived) so each update appends whole
  // lines instead of re-laying-out a half-written line ~20×/sec — that mid-line
  // reflow was the remaining transcript flicker while a response streamed.
  const contentFlushRef = useRef<{ length: number; atMs: number }>({
    length: 0,
    atMs: 0,
  });

  // Commit whatever assistant prose has streamed so far as an inline message,
  // then clear the live buffer. Called before each tool starts so the text that
  // preceded the tool keeps its place in the transcript (text → tool → text …)
  // instead of being dropped or rendered after the tool. The real messages
  // replace these optimistic ones when the turn commits.
  const flushStreamedText = useCallback((): void => {
    const text = streamingBufferRef.current;
    streamingBufferRef.current = '';
    contentFlushRef.current = { length: 0, atMs: 0 };
    setStreamingContent('');
    if (!text.trim()) return;
    setConversation((prev) =>
      prev
        ? {
            ...prev,
            messages: [...prev.messages, createMessage('assistant', text)],
          }
        : prev
    );
  }, []);
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
  // Completed thinking segments for the in-flight turn, in order. Each segment is
  // committed inline (as an optimistic assistant message) the moment it ends —
  // when a tool starts or the answer begins — so reasoning flows in place with
  // tools and prose instead of piling into one ever-growing block at the bottom.
  const thinkingSegmentsRef = useRef<
    Array<{ content: string; durationMs: number }>
  >([]);
  // Commit the current thinking buffer as an inline block and reset it, so the
  // next round of thinking starts fresh rather than re-rendering everything that
  // came before. Mirrors flushStreamedText, for reasoning.
  const flushStreamedThinking = useCallback((): void => {
    const t = thinkingRef.current;
    const text = t.buffer;
    const durationMs = t.durationMs ?? (t.startMs ? Date.now() - t.startMs : 0);
    thinkingRef.current = { buffer: '', startMs: 0, durationMs: null };
    setStreamingThinking('');
    setThinkingDuration(null);
    if (!text.trim()) return;
    thinkingSegmentsRef.current.push({ content: text, durationMs });
    setConversation((prev) =>
      prev
        ? {
            ...prev,
            messages: [
              ...prev.messages,
              createMessage('assistant', '', new Date(), undefined, {
                thinking: { content: text, durationMs },
              }),
            ],
          }
        : prev
    );
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  // Symbols of the file referenced by an active `@path::` mention, cached by
  // path so completing a method doesn't re-read the file on every keystroke.
  const [symbolsByPath, setSymbolsByPath] = useState<{
    path: string;
    symbols: string[];
  } | null>(null);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [thinkingCollapsed, setThinkingCollapsed] = useState(
    props.initialThinkingCollapsed ?? false
  );
  const [autoApprove, setAutoApprove] = useState(
    props.initialAutoApprove ?? false
  );
  const autoApproveRef = useRef(props.initialAutoApprove ?? false);
  const [localModelAutoRefresh, setLocalModelAutoRefresh] = useState(
    props.initialLocalModelAutoRefresh ?? true
  );
  const [modelAutoRefresh, setModelAutoRefresh] = useState(
    props.initialModelAutoRefresh ?? true
  );
  const [lazyToolLoading, setLazyToolLoading] = useState(
    props.initialLazyToolLoading ?? true
  );
  const [disabledTools, setDisabledTools] = useState<string[]>(
    props.initialDisabledTools ?? []
  );
  const [showToolsPicker, setShowToolsPicker] = useState(false);
  const [expandTools, setExpandTools] = useState(
    props.initialExpandTools ?? true
  );
  // View-only: hide model responses so the transcript shows just the user's
  // messages, for scanning back through what was asked. Not persisted.
  const [collapseResponses, setCollapseResponses] = useState(false);
  // The active chat mode (swaps the system prompt). Cycled with shift+tab, or
  // switched/created via the `/mode` picker.
  const [modes, setModes] = useState<ChatMode[]>(props.modes ?? []);
  const [showModePicker, setShowModePicker] = useState(false);
  const [activeMode, setActiveMode] = useState(
    props.initialMode ?? BUILD_MODE_ID
  );
  const activeModeInfo = modes.find((mode) => mode.id === activeMode);
  const activeModeName = activeModeInfo?.name ?? 'Build';
  const activeModeIcon = activeModeInfo ? modeGlyph(activeModeInfo.icon) : '';
  const maxReadLinesRef = useRef(
    props.initialMaxReadLines ?? DEFAULT_MAX_READ_LINES
  );
  const [maxReadLines, setMaxReadLines] = useState(
    props.initialMaxReadLines ?? DEFAULT_MAX_READ_LINES
  );
  const maxHistoryMessagesRef = useRef(
    props.initialMaxHistoryMessages ?? DEFAULT_MAX_HISTORY_MESSAGES
  );
  const [maxHistoryMessages, setMaxHistoryMessages] = useState(
    props.initialMaxHistoryMessages ?? DEFAULT_MAX_HISTORY_MESSAGES
  );
  // Auto-compact threshold (percent of the context window; 0 = off). The ref
  // mirrors the state so the post-turn check reads the current value.
  const autoCompactThresholdRef = useRef(
    props.initialAutoCompactThresholdPercent ??
      DEFAULT_AUTO_COMPACT_THRESHOLD_PERCENT
  );
  const [autoCompactThreshold, setAutoCompactThreshold] = useState(
    props.initialAutoCompactThresholdPercent ??
      DEFAULT_AUTO_COMPACT_THRESHOLD_PERCENT
  );
  // Guards re-entry: a compaction is a model call of its own, so a second
  // trigger (manual or auto) while one runs must be ignored.
  const compactingRef = useRef(false);
  // The last "auto-compact is close" milestone flashed (5/3/2/1 points left),
  // so each milestone warns once instead of re-flashing every turn. Reset when
  // the pressure drops (compaction, new session).
  const autoCompactWarnedMilestoneRef = useRef<number | null>(null);
  // Expected summary size for the compaction progress percentage: seeded with
  // the default, replaced by each compaction's actual summary size, so the
  // estimate tracks how this model/session actually summarizes.
  const expectedSummaryTokensRef = useRef(DEFAULT_EXPECTED_SUMMARY_TOKENS);
  // Reasoning effort is chosen per model (only models that advertise reasoning
  // support), nested by provider id. The ref mirrors the map so the submit
  // closure reads fresh values.
  const [reasoningEffortByModel, setReasoningEffortByModel] = useState<
    Record<
      string,
      Record<string, ReasoningEffort | 'off' | undefined> | undefined
    >
  >(props.initialReasoningEffortByModel ?? {});
  const reasoningEffortByModelRef = useRef(reasoningEffortByModel);
  reasoningEffortByModelRef.current = reasoningEffortByModel;
  const [showReasoningPicker, setShowReasoningPicker] = useState(false);
  const [pendingApproval, setPendingApproval] =
    useState<PendingApproval | null>(null);
  // A question the `question` tool put to the user; the answer is typed into the
  // normal prompt and submitting resolves the tool's awaiting promise.
  const [pendingQuestion, setPendingQuestion] =
    useState<PendingQuestion | null>(null);
  // Rendered diffs for file-changing tool calls, keyed by tool-call id (which
  // the committed messages share), so a write/edit/patch keeps showing its diff
  // inline in the transcript. Captured on the tool's 'start'; cleared only when
  // the session resets.
  const [liveToolDiffs, setLiveToolDiffs] = useState<Record<string, string>>(
    {}
  );
  // Index into the finished bash rows while browsing them with the keyboard;
  // null means we're not browsing (the prompt has focus as usual).
  const [browseIndex, setBrowseIndex] = useState<number | null>(null);
  // Messages submitted while a turn is in flight. They're folded into the
  // running turn to steer the model at the next round-trip (see drainSteering),
  // and any left over when the turn ends are sent together as the next turn.
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);
  // Mirrors queuedMessages so the steering callback (captured once when a turn
  // starts) always reads the latest queue rather than a stale snapshot.
  const queuedMessagesRef = useRef<string[]>([]);
  queuedMessagesRef.current = queuedMessages;
  // Index into queuedMessages while editing the queue with the keyboard; null
  // means we're not editing (the prompt has focus as usual). Pressing ↑ from an
  // empty prompt enters this mode, and Enter pulls the selected message back
  // into the prompt for editing.
  const [queueEditIndex, setQueueEditIndex] = useState<number | null>(null);
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
  // The reasoning command is only meaningful for models that advertise reasoning
  // support, so hide it entirely otherwise.
  const reasoningAvailable = Boolean(
    activeModelInfo?.reasoning?.effortLevels.length
  );
  const filteredCommands = useMemo(
    () =>
      isCommandMode
        ? filterCommands(commandQuery).filter(
            (cmd) => reasoningAvailable || cmd.name !== CommandName.Reasoning
          )
        : [],
    [isCommandMode, commandQuery, reasoningAvailable]
  );
  // Only MAX_COMMAND_ITEMS rows fit at once, so scroll a window over the full
  // list rather than truncating it — otherwise selection can't move past the
  // last visible row. The window slides down once the selection reaches the
  // bottom, always keeping the highlighted command in view.
  const commandWindowStart =
    selectedCommandIndex >= MAX_COMMAND_ITEMS
      ? selectedCommandIndex - MAX_COMMAND_ITEMS + 1
      : 0;
  const visibleCommands = filteredCommands.slice(
    commandWindowStart,
    commandWindowStart + MAX_COMMAND_ITEMS
  );

  const activeMentionQuery = useMemo(
    () => (isCommandMode ? null : getActiveMentionQuery(input)),
    [isCommandMode, input]
  );
  const activeMentionTrigger = useMemo(
    () => (isCommandMode ? false : hasActiveMentionTrigger(input)),
    [isCommandMode, input]
  );
  const showInterruptHint = isSending || pendingApproval !== null;
  // The reasoning effort in force for the active model, shown beside its name.
  const activeReasoningEffort = effectiveEffort(
    activeModelInfo?.reasoning,
    activeModelInfo
      ? reasoningEffortByModel[activeModelInfo.providerId]?.[activeModel]
      : undefined
  );
  const displayStats = isSending
    ? getLiveStats(
        responseTimingRef.current,
        turnOutputCharsRef.current,
        activityTick,
        tokensPerSecondAvgRef.current.avg
      )
    : lastStats;
  const mentionSuggestions = useMemo(
    () =>
      filterMentionSuggestions(workspaceFiles, activeMentionQuery ?? undefined),
    [activeMentionQuery, workspaceFiles]
  );
  // A trailing `@path::query` mention switches the autocomplete from files to
  // the symbols declared in that file (fetched lazily into symbolsByPath).
  const activeSymbolMention = useMemo(
    () => (isCommandMode ? undefined : getActiveSymbolMention(input)),
    [isCommandMode, input]
  );
  const symbolsForPath =
    symbolsByPath && activeSymbolMention?.path === symbolsByPath.path
      ? symbolsByPath.symbols
      : [];
  const symbolSuggestions = useMemo(
    () => filterSymbolSuggestions(symbolsForPath, activeSymbolMention?.query),
    [symbolsForPath, activeSymbolMention?.query]
  );
  const showSymbolSuggestions =
    activeSymbolMention !== undefined && symbolsForPath.length > 0;
  const showMentionSuggestions =
    activeMentionTrigger && !isCommandMode && workspaceFiles.length > 0;
  const noMentionMatches =
    activeMentionTrigger &&
    activeMentionQuery !== undefined &&
    mentionSuggestions.length === 0;
  // The list the keyboard navigates, plus how applying it rewrites the prompt —
  // symbol completion when `@path::` is active, file completion otherwise.
  const activeSuggestions = showSymbolSuggestions
    ? symbolSuggestions
    : mentionSuggestions;
  const selectedSuggestion =
    activeSuggestions[selectedSuggestionIndex] ?? activeSuggestions[0];
  const applyActiveSuggestion = useCallback(
    (content: string, suggestion: string): string =>
      showSymbolSuggestions
        ? applySymbolSuggestion(content, suggestion)
        : applyMentionSuggestion(content, suggestion),
    [showSymbolSuggestions]
  );

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

  // Load the referenced file's symbols when a `@path::` mention becomes active,
  // cached by path so re-typing the symbol query doesn't re-read the file.
  useEffect(() => {
    const path = activeSymbolMention?.path;
    if (!path || symbolsByPath?.path === path) {
      return;
    }

    let cancelled = false;
    void props.promptAttachmentService.listSymbols(path).then((symbols) => {
      if (!cancelled) {
        setSymbolsByPath({ path, symbols });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeSymbolMention?.path, props.promptAttachmentService, symbolsByPath]);

  // Push `input` into the uncontrolled textarea only when it diverges — i.e. when
  // we changed it programmatically (clearing on submit, tab-completion, restoring
  // an interrupted prompt). During normal typing `area.plainText === input`, so
  // this is a no-op and the textarea keeps its own cursor. Focus is handled
  // declaratively by the textarea's `focused` prop and the effect below; we must
  // NOT re-focus here, since this runs on every keystroke and the repeated focus
  // call caused the input to flicker / show a ghost cursor.
  useEffect(() => {
    const area = promptAreaRef.current;
    if (!area || area.isDestroyed) return;

    // A change that came from the textarea itself (typing) is already in the
    // buffer — and `input` may lag it under fast input — so skip the write-back
    // to avoid resetting the buffer to a stale value mid-type. Consume-once so a
    // subsequent programmatic change (clear/tab-complete/command) still syncs.
    if (inputFromAreaRef.current) {
      inputFromAreaRef.current = false;
      return;
    }

    if (area.plainText !== input) {
      area.setText(input);
      area.cursorOffset = input.length;
    }
  }, [input]);

  useFocus(() => {
    setTerminalFocused(true);
  });

  useBlur(() => {
    setTerminalFocused(false);
  });

  useEffect(() => {
    // The prompt stays focused even while a turn is sending so the user can type
    // ahead and queue the next message. Only the keyboard-driven browse/edit
    // modes (which steer arrows to navigation) take focus away from it.
    if (!terminalFocused || browseIndex !== null || queueEditIndex !== null) {
      return;
    }

    const area = promptAreaRef.current;
    if (!area || area.isDestroyed) {
      return;
    }

    area.focus();
  }, [
    browseIndex,
    queueEditIndex,
    isSending,
    pendingQuestion,
    terminalFocused,
  ]);

  const configuredProviderIds = Object.keys(
    savedConfig.providers ?? {}
  ) as ProviderId[];
  const configuredProviders = savedConfig.providers ?? {};

  // The startup providers carry their credentials in memory, so a reset must
  // clear them too — otherwise the listModels effect below re-fetches from the
  // old clients and resurrects the models cache (and the picker) from scratch.
  const [baseProviders, setBaseProviders] = useState(props.allProviders);

  const availableProviders = useMemo(
    () => mergeProviders(baseProviders, connectedProviders),
    [connectedProviders, baseProviders]
  );

  const resolveProviderClient = (providerId: ProviderId): ProviderClient =>
    availableProviders.find((provider) => provider.providerId === providerId) ??
    props.createProvider(providerId);

  const renderer = useRenderer();

  // Transient "Copied" flash shown in the status line after a selection copies.
  const [copiedNotice, setCopiedNotice] = useState(false);
  const copiedNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // Copy text as soon as the user finishes highlighting it with the mouse
  // (the "selection" event fires once on mouse-up). We keep the highlight
  // visible — copying is a side effect, not a selection change.
  useSelectionHandler((selection) => {
    const selectedText = selection.getSelectedText();
    if (!selectedText.trim()) return;

    // Over SSH the platform clipboard CLI writes the *remote* machine's
    // clipboard, so OSC52 — which the terminal relays to the local one — is
    // the only path that reaches the user. Locally it's the opposite: some
    // terminals (macOS Terminal.app among them) silently discard OSC52 while
    // emitting it still "succeeds", so the native CLI is authoritative and
    // OSC52 is only the fallback.
    const overSsh = Boolean(process.env.SSH_TTY ?? process.env.SSH_CONNECTION);
    const copied = overSsh
      ? renderer.copyToClipboardOSC52(selectedText) ||
        copyToClipboard(selectedText)
      : copyToClipboard(selectedText) ||
        renderer.copyToClipboardOSC52(selectedText);
    if (!copied) return;

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

  // Transient command output (e.g. /context-usage) flashed in the notification
  // slot. Plain `status` is masked by the TTFT/tok-s readout once a turn has
  // completed, so command feedback needs this higher-priority slot to stay
  // visible; it clears after a few seconds and the stats return.
  const [commandNotice, setCommandNotice] = useState<
    StyledText | string | null
  >(null);
  const commandNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const flashCommandNotice = (text: StyledText | string): void => {
    setCommandNotice(text);
    if (commandNoticeTimerRef.current) {
      clearTimeout(commandNoticeTimerRef.current);
    }
    commandNoticeTimerRef.current = setTimeout(() => {
      setCommandNotice(null);
      commandNoticeTimerRef.current = null;
    }, 6000);
  };

  useEffect(
    () => () => {
      if (commandNoticeTimerRef.current) {
        clearTimeout(commandNoticeTimerRef.current);
      }
    },
    []
  );

  // Show a "Jump to bottom" affordance whenever the transcript is scrolled up
  // away from the latest output. The scrollbox has no public scroll event, so
  // we poll it on a short interval; setState bails out when the value is
  // unchanged, so this stays cheap.
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  // The "Jump to top" twin: only while unpinned from the bottom (the user
  // started scrolling up) and not already parked at the top.
  const [showJumpToTop, setShowJumpToTop] = useState(false);
  // Whether the transcript is currently parked at the bottom. Read by the
  // auto-scroll effect so a finished turn only snaps down when the user was
  // already at the bottom — if they've scrolled up to read, we leave them be.
  const isAtBottomRef = useRef(true);

  useEffect(() => {
    const interval = setInterval(() => {
      const scrollBox = scrollRef.current;
      if (!scrollBox) {
        setShowJumpToBottom(false);
        setShowJumpToTop(false);
        return;
      }
      const maxScroll = Math.max(
        0,
        scrollBox.scrollHeight - scrollBox.viewport.height
      );
      // Treat "within one row of the end" as the bottom to avoid flicker.
      const atBottom = scrollBox.scrollTop >= maxScroll - 1;
      isAtBottomRef.current = atBottom;
      setShowJumpToBottom(maxScroll > 0 && !atBottom);
      setShowJumpToTop(maxScroll > 0 && !atBottom && scrollBox.scrollTop > 1);
    }, 150);
    return () => clearInterval(interval);
  }, []);

  useKeyboard((key) => {
    if (
      showModelPicker ||
      showConnectPicker ||
      showSessionPicker ||
      showReasoningPicker ||
      showToolsPicker ||
      showModePicker
    )
      return;

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
      setPendingImages([]);
      armExit();
      return;
    }

    // Ctrl+V attaches an image from the clipboard. This is the reliable trigger:
    // terminals don't forward pasted image bytes over stdin, so we read the OS
    // clipboard directly. (A plain Cmd/Ctrl+V text paste still works as usual
    // via the textarea's own paste handling.)
    if (key.ctrl && key.name === 'v') {
      if (attachClipboardImage()) return;
    }

    // Shift+Tab cycles the chat mode (Build → Ask → Plan → custom → …), swapping
    // the system prompt for the next turn.
    if (key.name === KeyName.Tab && key.shift && modes.length > 1) {
      const index = modes.findIndex((mode) => mode.id === activeMode);
      const next = modes[(index + 1) % modes.length];
      if (next) {
        setActiveMode(next.id);
        props.onModeChange?.(next.id);
        setStatus(`Mode: ${next.name}`);
      }
      return;
    }

    // Editing the queued messages: arrows move the selection, Enter pulls the
    // selected message back into the prompt (removing it from the queue) so it
    // can be edited and resent, Esc returns to the prompt.
    if (queueEditIndex !== null) {
      if (key.name === KeyName.Escape) {
        setQueueEditIndex(null);
        return;
      }
      if (key.name === KeyName.Up) {
        setQueueEditIndex((i) => Math.max(0, (i ?? 0) - 1));
        return;
      }
      if (key.name === KeyName.Down) {
        setQueueEditIndex((i) =>
          Math.min(queuedMessages.length - 1, (i ?? 0) + 1)
        );
        return;
      }
      if (key.name === KeyName.Return) {
        const index = queueEditIndex;
        const message = queuedMessages[index];
        if (message !== undefined) {
          setQueuedMessages((queue) => queue.filter((_, i) => i !== index));
          setQueueEditIndex(null);
          setInputWithCursorAtEnd(message);
        }
        return;
      }
      // Swallow everything else so stray keys don't leak while editing.
      return;
    }

    // Enter queue-edit mode from an empty prompt when messages are queued. This
    // takes priority over bash browsing (which only triggers when idle), so a
    // queued-up message is always reachable with ↑ while a turn is in flight.
    if (
      key.name === KeyName.Up &&
      !input &&
      queuedMessages.length > 0 &&
      !isCommandMode &&
      !showMentionSuggestions
    ) {
      setQueueEditIndex(queuedMessages.length - 1);
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
        setPendingImages([]);
        disarmExit();
        setStatus('Ready');
        return;
      }

      exit();
      return;
    }

    if (isCommandMode && filteredCommands.length) {
      if (key.name === 'down') {
        setSelectedCommandIndex((i) =>
          Math.min(i + 1, filteredCommands.length - 1)
        );
        return;
      }
      if (key.name === 'up') {
        setSelectedCommandIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (key.name === 'tab') {
        const cmd = filteredCommands[selectedCommandIndex];
        if (cmd) setInputWithCursorAtEnd(`/${cmd.name} `);
        return;
      }
      return;
    }

    if (!showMentionSuggestions && !showSymbolSuggestions) return;

    if (key.name === 'down') {
      setSelectedSuggestionIndex((i) =>
        Math.min(i + 1, activeSuggestions.length - 1)
      );
      return;
    }
    if (key.name === 'up') {
      setSelectedSuggestionIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (key.name === 'tab') {
      if (selectedSuggestion) {
        setInputWithCursorAtEnd(
          applyActiveSuggestion(input, selectedSuggestion)
        );
      }
    }
  });

  useEffect(() => {
    setSelectedCommandIndex(0);
  }, [commandQuery]);

  useEffect(() => {
    setSelectedSuggestionIndex(0);
  }, [activeMentionQuery, activeSymbolMention?.query]);

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

  // Snap the transcript to the bottom when a message is committed, but only if
  // the user was already parked at the bottom. If they've scrolled up to read
  // (e.g. while the model finishes), leave them there instead of yanking them
  // down. Per-token streaming growth is handled by the scrollbox's stickyScroll.
  useEffect(() => {
    if (isAtBottomRef.current) {
      scrollToBottom();
    }
  }, [conversation?.messages.length, scrollToBottom]);

  // A freshly loaded session always starts at its latest message, regardless
  // of where the user had scrolled before (isAtBottomRef survives session
  // switches, so the effect above alone would leave a resumed session at the
  // top). Scroll again on the next tick: the transcript's real height (markdown
  // layout, wrapped lines) lands after this commit, and a single synchronous
  // scrollTo would target the stale, shorter height.
  useEffect(() => {
    if (!session) return;
    isAtBottomRef.current = true;
    scrollToBottom();
    const timer = setTimeout(scrollToBottom, 0);
    return () => clearTimeout(timer);
  }, [session, scrollToBottom]);

  // Leave browse mode if there are no rows to point at, and clamp the cursor if
  // the list shrank (e.g. a new session cleared the conversation).
  useEffect(() => {
    setBrowseIndex((current) => {
      if (current === null) return null;
      if (bashToolMessages.length === 0) return null;
      return Math.min(current, bashToolMessages.length - 1);
    });
  }, [bashToolMessages.length]);

  // Leave queue-edit mode when the queue empties, and clamp the cursor if the
  // queue shrank (e.g. a message was sent or pulled out for editing).
  useEffect(() => {
    setQueueEditIndex((current) => {
      if (current === null) return null;
      if (queuedMessages.length === 0) return null;
      return Math.min(current, queuedMessages.length - 1);
    });
  }, [queuedMessages.length]);

  // Send anything still queued once the active turn finishes. Most messages are
  // folded into the running turn via steering; this catches whatever was queued
  // after the model's final round-trip (or while idle). They're combined into a
  // single turn so they're sent all at once. Paused while the user is editing
  // the queue so their in-progress edit isn't sent out from under them.
  useEffect(() => {
    if (isSending || queueEditIndex !== null) return;
    if (queuedMessages.length === 0) return;
    if (!conversation || !session) return;

    const combined = queuedMessages.join('\n\n');
    setQueuedMessages([]);
    void submit(combined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSending, queuedMessages, queueEditIndex, conversation, session]);

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

  // Writes the current footer metrics (ctx/cost/tok-s) onto the session's
  // persisted conversation so resuming it restores them. Best-effort — the
  // service swallows failures, so this never disturbs the turn.
  const persistSessionStats = (sessionId: string): void => {
    const stats: SessionStats = {
      ...metricsRef.current,
      ...(lastStatsRef.current
        ? {
            ttftMs: lastStatsRef.current.ttftMs,
            tokensPerSecond: lastStatsRef.current.tokensPerSecond,
          }
        : {}),
      avgTokensPerSecond: tokensPerSecondAvgRef.current.avg,
      completedTurnCount: tokensPerSecondAvgRef.current.count,
    };
    void props.chatSessionService.saveSessionStats(sessionId, stats);
  };

  // Seeds the footer metrics from a loaded conversation's persisted stats, so
  // reopening a session picks up where its ctx/cost/tok-s readouts left off.
  const restoreSessionStats = (stats: SessionStats | undefined): void => {
    if (!stats) return;
    updateMetrics(() => ({
      inputTokens: stats.inputTokens,
      outputTokens: stats.outputTokens,
      cachedTokens: stats.cachedTokens,
      cost: stats.cost,
      lastInputTokens: stats.lastInputTokens,
    }));
    tokensPerSecondAvgRef.current = {
      avg: stats.avgTokensPerSecond ?? 0,
      count: stats.completedTurnCount ?? 0,
    };
    if (stats.ttftMs !== undefined && stats.tokensPerSecond !== undefined) {
      updateLastStats({
        ttftMs: stats.ttftMs,
        tokensPerSecond: stats.tokensPerSecond,
        avgTokensPerSecond: tokensPerSecondAvgRef.current.avg,
      });
    }
  };

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
          restoreSessionStats(startedSession.conversation.stats);
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
    // modelsRefreshKey is intentionally a dep: bumping it re-fetches the lists.
  }, [availableProviders, modelsRefreshKey]);

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
      setAutoApprove(true);
      autoApproveRef.current = true;
      props.onAutoApproveChange?.(true);
    }
    setPendingApproval((current) => {
      current?.resolve(approved);
      return null;
    });
  };

  // Hand the typed answer back to the awaiting question tool, then clear the
  // prompt. A bare option number (when options were offered) is expanded to that
  // option's text so the user can answer with "2" instead of retyping it.
  const resolveQuestion = (answer: string): void => {
    setPendingQuestion((current) => {
      if (!current) return null;
      let finalAnswer = answer.trim();
      const options = current.request.options;
      if (options && /^\d+$/.test(finalAnswer)) {
        const index = Number.parseInt(finalAnswer, 10) - 1;
        if (index >= 0 && index < options.length) {
          finalAnswer = options[index] ?? finalAnswer;
        }
      }
      current.resolve(finalAnswer);
      return null;
    });
    setInput('');
    const area = promptAreaRef.current;
    if (area && !area.isDestroyed) {
      area.setText('');
      area.cursorOffset = 0;
    }
    setStatus('Working...');
  };

  // The markdown of the most recently presented plan (the last `present_plan`
  // tool result), or null if the model hasn't proposed one yet. Backs the
  // /implement and /edit-plan hand-offs, which have no plan to act on otherwise.
  const findLatestPlanContent = (): string | null => {
    const messages = conversation?.messages ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (
        message?.role === 'tool' &&
        message.name === 'present_plan' &&
        message.content.trim()
      ) {
        return message.content;
      }
    }
    return null;
  };

  const executeCommand = (name: CommandName, arg?: string): void => {
    setInput('');
    setError(null);

    switch (name) {
      case CommandName.Models:
        setShowModelPicker(true);
        return;

      case CommandName.RefreshModels:
        setStatus('Refreshing models…');
        void clearModelsCache().then(() => {
          setModelsRefreshKey((key) => key + 1);
          setStatus('Models refreshed');
        });
        return;

      case CommandName.Sessions:
        setShowSessionPicker(true);
        return;

      case CommandName.Rename: {
        const title = (arg ?? '').trim();
        if (!title) {
          setStatus(
            `This session is "${currentSessionLabel}" (use /rename-session <title> to change it)`
          );
          return;
        }
        setStatus('Renaming session…');
        void props.chatSessionService
          .renameSession(currentSessionId, title)
          .then(() => {
            // Reflect the new title in the header without a reload.
            setConversation((prev) =>
              prev && prev.sessionId === currentSessionId
                ? { ...prev, title }
                : prev
            );
            setStatus(`Renamed session to "${title}"`);
          })
          .catch((caughtError: unknown) => {
            setError(getErrorMessage(caughtError));
          });
        return;
      }

      case CommandName.Connect:
        setStatus('Select a provider to connect');
        setShowConnectPicker(true);
        return;

      case CommandName.Config:
        void openFileInEditor(props.configFilePath)
          .then(() => {
            setStatus('Opened config file');
          })
          .catch((caughtError: unknown) => {
            setError(getErrorMessage(caughtError));
          });
        return;

      case CommandName.ConfigureMcpServers:
        // Seed an empty mcp.json on first use so the editor always opens a valid
        // file, then open it. Changes take effect on the next launch, when MCP
        // servers are (re)connected.
        void ensureMcpConfigFile(props.configDirectory)
          .then((path) => openFileInEditor(path))
          .then(() => {
            setStatus('Opened mcp.json — restart to apply MCP server changes');
          })
          .catch((caughtError: unknown) => {
            setError(getErrorMessage(caughtError));
          });
        return;

      case CommandName.ReadLimit: {
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

      case CommandName.ContextWindow: {
        const trimmed = (arg ?? '').trim();
        const current = maxHistoryMessagesRef.current;
        if (!trimmed) {
          setStatus(
            current > 0
              ? `Context window is ${current} items (use /context-window <count|off> to change)`
              : 'Context window is off — the full conversation is sent (use /context-window <count> to cap it)'
          );
          return;
        }
        // "off" disables trimming (send the whole conversation); a positive
        // count caps how many recent context window items are forwarded.
        const isOff = trimmed.toLowerCase() === 'off';
        const count = isOff ? 0 : Number.parseInt(trimmed, 10);
        if (!isOff && (!Number.isFinite(count) || count <= 0)) {
          setError(
            `Invalid context window '${trimmed}'. Provide a positive number of items or "off".`
          );
          return;
        }
        maxHistoryMessagesRef.current = count;
        setMaxHistoryMessages(count);
        props.onMaxHistoryMessagesChange?.(count);
        setStatus(
          count > 0
            ? `Context window set to ${count} items`
            : 'Context window turned off — sending the full conversation'
        );
        return;
      }

      case CommandName.ContextUsage: {
        const windowSize = activeModelInfo?.contextWindow;
        if (windowSize == null) {
          flashCommandNotice(
            activeModelInfo
              ? `${activeModelInfo.displayName} doesn't report a context window`
              : 'Pick a model before checking context usage'
          );
          return;
        }
        // Context usage is the size of the most recent request (what the model
        // currently sees), not the session's cumulative input-token total.
        const pct = contextPct(metrics.lastInputTokens, windowSize);
        flashCommandNotice(
          new StyledText([
            tc('Context ', { fg: MUTED }),
            tc(`${contextBar(pct)} ${pct}%`, { fg: contextUsageColor(pct) }),
            tc(' · ', { fg: MUTED }),
            tc(
              `${metrics.lastInputTokens.toLocaleString()} / ${windowSize.toLocaleString()} tokens`,
              { fg: 'white' }
            ),
          ])
        );
        return;
      }

      case CommandName.Compact:
        void runCompaction('manual');
        return;

      case CommandName.AutoCompact: {
        const trimmed = (arg ?? '').trim();
        const current = autoCompactThresholdRef.current;
        if (!trimmed) {
          setStatus(
            current > 0
              ? `Auto-compact triggers at >=${current}% of the context window (use /auto-compact <percent|off> to change)`
              : 'Auto-compact is off (use /auto-compact <percent> to enable)'
          );
          return;
        }
        const isOff = trimmed.toLowerCase() === 'off';
        const percent = isOff ? 0 : Number.parseInt(trimmed, 10);
        if (
          !isOff &&
          (!Number.isFinite(percent) || percent < 0 || percent > 100)
        ) {
          setError(
            `Invalid auto-compact threshold '${trimmed}'. Provide a percent from 1 to 100, or "off" (0 also turns it off).`
          );
          return;
        }
        autoCompactThresholdRef.current = percent;
        setAutoCompactThreshold(percent);
        props.onAutoCompactThresholdChange?.(percent);
        setStatus(
          percent > 0
            ? `Auto-compact set to ${percent}% of the context window`
            : 'Auto-compact turned off'
        );
        return;
      }

      case CommandName.AutoApprove: {
        const next = !autoApproveRef.current;
        setAutoApprove(next);
        autoApproveRef.current = next;
        props.onAutoApproveChange?.(next);
        setStatus(
          next ? 'Auto-approving all actions' : 'Confirming each action'
        );
        return;
      }

      case CommandName.LocalRefresh: {
        const next = !localModelAutoRefresh;
        setLocalModelAutoRefresh(next);
        props.onLocalModelAutoRefreshChange?.(next);
        setStatus(
          next
            ? 'Always refreshing local models'
            : 'Local models use the daily cache'
        );
        return;
      }

      case CommandName.ModelAutoRefresh: {
        const next = !modelAutoRefresh;
        setModelAutoRefresh(next);
        props.onModelAutoRefreshChange?.(next);
        setStatus(
          next
            ? 'Refreshing cached model lists daily'
            : 'Model lists only refresh via /refresh-models'
        );
        return;
      }

      case CommandName.LazyToolLoading: {
        const next = !lazyToolLoading;
        setLazyToolLoading(next);
        props.onLazyToolLoadingChange?.(next);
        setStatus(
          next
            ? 'Lazy tool loading on — model loads tools via lazy_load_tools'
            : 'Lazy tool loading off — all tools sent by default'
        );
        return;
      }

      case CommandName.ExpandTools: {
        const next = !expandTools;
        setExpandTools(next);
        props.onExpandToolsChange?.(next);
        setStatus(
          next ? 'Showing full tool output inline' : 'Collapsing tool output'
        );
        return;
      }

      case CommandName.ManageTools: {
        if (!props.manageableTools?.length) {
          setStatus('No tools available to manage');
          return;
        }
        setShowToolsPicker(true);
        return;
      }

      case CommandName.Mode: {
        if (modes.length === 0) {
          setStatus('No modes available');
          return;
        }
        setShowModePicker(true);
        return;
      }

      // The CLI has no clickable "Start" button after a plan, so /implement is
      // the hand-off: switch to Build (so the model can edit files) and steer it
      // to carry out the plan already sitting in the conversation.
      case CommandName.Implement: {
        if (!findLatestPlanContent()) {
          // setError (not setStatus): executeCommand clears error to null on
          // every call, so this re-fires each time — a repeated setStatus with
          // the same string is a React bail-out that wouldn't show again.
          setError('No plan yet — ask for a plan first (try Plan mode)');
          return;
        }
        setActiveMode(BUILD_MODE_ID);
        // onModeChange swaps the runtime's system prompt synchronously, so the
        // turn kicked off just below already runs under Build.
        props.onModeChange?.(BUILD_MODE_ID);
        void submit('Implement the plan above.');
        return;
      }

      // The CLI has no "Edit" button either: write the latest plan to a file in
      // the working directory and open it, so the user can revise it before
      // running /implement.
      case CommandName.EditPlan: {
        const plan = findLatestPlanContent();
        if (!plan) {
          setError('No plan yet — ask for a plan first');
          return;
        }
        let target = join(process.cwd(), 'plan.md');
        for (let n = 1; existsSync(target); n++) {
          target = join(process.cwd(), `plan-${n}.md`);
        }
        void writeFile(target, plan, 'utf8')
          .then(() => openFileInEditor(target))
          .then(() => {
            setStatus(
              `Saved plan to ${basename(target)} — edit, then /implement`
            );
          })
          .catch((caughtError: unknown) => {
            setError(getErrorMessage(caughtError));
          });
        return;
      }

      case CommandName.CollapseResponses: {
        const next = !collapseResponses;
        setCollapseResponses(next);
        setStatus(
          next
            ? 'Hiding model responses — showing only your messages'
            : 'Showing model responses'
        );
        return;
      }

      case CommandName.Thinking: {
        const next = !thinkingCollapsed;
        setThinkingCollapsed(next);
        props.onThinkingCollapsedChange?.(next);
        setStatus(next ? 'Thinking collapsed' : 'Thinking expanded');
        return;
      }

      case CommandName.Reasoning: {
        // Per-model setting: only models that advertise reasoning support can be
        // configured, and the choices come from the model itself.
        if (!activeModelInfo?.reasoning?.effortLevels.length) {
          setStatus(
            activeModelInfo
              ? `${activeModelInfo.displayName} doesn't support reasoning effort`
              : 'Pick a model before setting reasoning effort'
          );
          return;
        }
        setShowReasoningPicker(true);
        return;
      }

      case CommandName.NewSession: {
        // A session that never received a message is already fresh — reuse it
        // instead of minting another. Re-save it so its file exists on disk
        // even when the session was started before this persist-on-create.
        if (conversation && conversation.messages.length === 0) {
          // Best-effort: the first turn's save creates the file if this fails.
          void props.chatSessionService
            .saveConversation(conversation)
            .catch(() => {});
          setStatus('Already in a fresh session');
          return;
        }
        resetFreshSessionState();
        const newId = randomUUID();
        const nextRequestedModel = activeModel || props.requestedModel;
        nextSessionRequestedModelRef.current = nextRequestedModel;
        // Persist the empty session immediately so it exists (and shows in
        // the session picker) before the first message is sent.
        // Best-effort: the first turn's save creates the file if this fails.
        void props.chatSessionService
          .saveConversation(createConversation(newId))
          .catch(() => {});
        setCurrentSessionId(newId);
        return;
      }

      case CommandName.Clear:
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
        return;

      case CommandName.ClearSessions: {
        void props.chatSessionService
          .listSessions()
          .then((sessions) => {
            if (sessions.length === 0) {
              setStatus('No saved sessions to delete');
              return;
            }
            sessionsToDeleteRef.current = sessions.map((s) => s.sessionId);
            setSessionsToDeleteCount(sessions.length);
            setShowModelPicker(false);
            setShowSessionPicker(false);
            setShowConnectPicker(false);
            setShowResetPicker(false);
            setShowClearSessionsPicker(true);
          })
          .catch((caughtError: unknown) => {
            setError(getErrorMessage(caughtError));
          });
        return;
      }

      case CommandName.Reset: {
        setShowModelPicker(false);
        setShowSessionPicker(false);
        setShowConnectPicker(false);
        setShowResetPicker(true);
        return;
      }
    }
  };

  /**
   * Summarizes the conversation and swaps it for the compacted one. `target`
   * lets the post-turn auto trigger pass the turn's fresh conversation (the
   * `conversation` state may not have committed yet); the manual command
   * omits it and compacts the current state. Runs as its own model call, so
   * it takes the sending slot (spinner, queued messages) like a normal turn.
   */
  const runCompaction = async (
    trigger: 'manual' | 'auto',
    target?: Conversation
  ): Promise<void> => {
    if (compactingRef.current || activeRequestControllerRef.current) return;
    const conversationToCompact = target ?? conversation;
    if (!conversationToCompact || !session) return;
    const model = activeModel || session.activeModel;
    if (!model) {
      if (trigger === 'manual') {
        flashCommandNotice('Pick a model before compacting');
      }
      return;
    }
    const [firstMessage] = conversationToCompact.messages;
    if (
      conversationToCompact.messages.length === 0 ||
      (conversationToCompact.messages.length === 1 &&
        firstMessage?.isCompactSummary)
    ) {
      if (trigger === 'manual') {
        flashCommandNotice('Nothing to compact yet');
      }
      return;
    }

    const requestController = new AbortController();
    activeRequestControllerRef.current = requestController;
    compactingRef.current = true;
    setIsSending(true);
    const compactLabel =
      trigger === 'auto'
        ? 'Context almost full — compacting conversation...'
        : 'Compacting conversation...';
    setStatus(compactLabel);
    try {
      const provider = activeModelInfo?.providerId ?? activeProviderId;
      const effort = effectiveEffort(
        activeModelInfo?.reasoning,
        provider
          ? reasoningEffortByModelRef.current[provider]?.[model]
          : undefined
      );
      // The summary streams like any reply; show its growth as an estimated
      // percentage (against the previous summary's size) in the notification
      // slot — the status line is hidden behind the live stats while a
      // request is in flight, so the priority slot is the visible one.
      let summaryChars = 0;
      let lastProgressUpdate = 0;
      const result = await props.chatSessionService.compactSession({
        conversation: conversationToCompact,
        model,
        ...(effort ? { reasoningEffort: effort } : {}),
        signal: requestController.signal,
        onToken: (token) => {
          summaryChars += token.length;
          const now = Date.now();
          if (now - lastProgressUpdate < 250) return;
          lastProgressUpdate = now;
          // Same chars→tokens heuristic as estimateTokenCount.
          const summaryTokens = Math.max(1, Math.round(summaryChars / 4));
          const pct = compactProgressPercent(
            summaryTokens,
            expectedSummaryTokensRef.current
          );
          flashCommandNotice(
            new StyledText([
              tc('Compacting ', { fg: MUTED }),
              tc(`${contextBar(pct)} ~${pct}%`, { fg: 'cyan' }),
              tc(` · ${summaryTokens.toLocaleString()} summary tokens`, {
                fg: MUTED,
              }),
            ])
          );
        },
      });
      setConversation(result.conversation);
      // The summarization call is a real request: fold its usage into the
      // session totals, but zero the ctx readout — the next turn starts from
      // the compact summary, and this also keeps auto-compact from refiring.
      const usage = result.usage;
      const pricing = activeModelInfo?.pricing;
      updateMetrics((prev) => ({
        inputTokens: prev.inputTokens + (usage?.inputTokens ?? 0),
        outputTokens: prev.outputTokens + (usage?.outputTokens ?? 0),
        cachedTokens: prev.cachedTokens + (usage?.cachedTokens ?? 0),
        cost:
          prev.cost +
          (usage?.cost ??
            (usage && pricing
              ? usage.inputTokens * pricing.inputPerToken +
                usage.outputTokens * pricing.outputPerToken +
                usage.cachedTokens *
                  (pricing.cacheReadPerToken ?? pricing.inputPerToken)
              : 0)),
        lastInputTokens: 0,
      }));
      persistSessionStats(result.conversation.sessionId);
      // Pressure has dropped back to zero; re-arm the approach warnings, and
      // remember this summary's size as the next compaction's 100% estimate.
      autoCompactWarnedMilestoneRef.current = null;
      expectedSummaryTokensRef.current = Math.max(
        1,
        Math.round(result.summary.length / 4)
      );
      setStatus('Ready');
      flashCommandNotice('Conversation compacted');
    } catch (caughtError: unknown) {
      if (isAbortError(caughtError)) {
        // Nothing was saved: an aborted compaction leaves the conversation
        // exactly as it was.
        setStatus('Compaction cancelled');
      } else {
        setError(getErrorMessage(caughtError));
        setStatus('Compaction failed');
      }
    } finally {
      compactingRef.current = false;
      setIsSending(false);
      activeRequestControllerRef.current = null;
    }
  };

  const submit = async (value: string): Promise<void> => {
    if (!value.trim()) return;

    // A turn is already in flight: queue plain messages to send next instead of
    // dropping them. Commands aren't queued (they'd run against a moving session
    // state), so they're simply ignored until the turn finishes.
    if (isSending) {
      if (parseCommandInput(value) !== null) return;
      // Queued messages can't carry images (they're folded into the running
      // turn as plain steering text), so strip the markers and drop any staged
      // images, noting it so the paste isn't silently lost.
      const queuedText = value.replace(IMAGE_MARKER_PATTERN, ' ').trim();
      if (pendingImagesRef.current.length > 0) {
        setPendingImages([]);
        setStatus('Images are only sent with a new message, not while sending');
      }
      if (queuedText) setQueuedMessages((queue) => [...queue, queuedText]);
      setInputWithCursorAtEnd('');
      return;
    }

    if (
      (showSymbolSuggestions || showMentionSuggestions) &&
      selectedSuggestion
    ) {
      setInputWithCursorAtEnd(applyActiveSuggestion(value, selectedSuggestion));
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
        if (isCommandName(commandName)) {
          executeCommand(commandName, arg);
        } else {
          setError(`Unknown command '/${commandName}'.`);
        }
      } else {
        // No argument: honour the highlighted suggestion (the `›` cursor the
        // user navigated to), falling back to an exact typed name only when the
        // palette has no matches. Preferring the exact name would run the typed
        // command (e.g. "/mode") even after the user arrowed down to another
        // entry (e.g. "/models").
        const exact = isCommandName(commandName)
          ? COMMANDS.find((c) => c.name === commandName)
          : undefined;
        const selected = filteredCommands[selectedCommandIndex] ?? exact;
        if (selected) executeCommand(selected.name);
      }
      setInput('');
      return;
    }

    if (!conversation || !session) return;

    // Pull the staged images for this turn and strip their `[Image #n]` markers
    // from the prose — the images travel as proper image blocks, not as text.
    const turnImages: MessageImage[] = pendingImagesRef.current.map(
      ({ mediaType, data }) => ({ mediaType, data })
    );
    const cleanedValue = value.replace(IMAGE_MARKER_PATTERN, ' ').trim();
    setPendingImages([]);

    const requestController = new AbortController();
    activeRequestControllerRef.current = requestController;
    submittedPromptRef.current = value;

    const baseConversation = conversation;

    // Tracks whether any model response this turn reported usage. When it did,
    // the metrics line was already updated live via onUsage, so the end-of-turn
    // accounting must not double-count; when it didn't, we fall back to an
    // estimate there.
    let turnReportedUsage = false;

    setError(null);
    setIsSending(true);
    // Show the user's message immediately, before the model starts responding.
    const optimisticUserMessage = createMessage(
      'user',
      cleanedValue,
      new Date(),
      undefined,
      turnImages.length ? { images: turnImages } : undefined
    );
    setConversation({
      ...baseConversation,
      messages: [...baseConversation.messages, optimisticUserMessage],
    });
    setStreamingContent('');
    setStreamingThinking('');
    setThinkingDuration(null);
    setBrowseIndex(null);
    streamingBufferRef.current = '';
    contentFlushRef.current = { length: 0, atMs: 0 };
    thinkingRef.current = { buffer: '', startMs: 0, durationMs: null };
    thinkingSegmentsRef.current = [];
    responseTimingRef.current = { startMs: Date.now(), firstTokenMs: null };
    turnOutputCharsRef.current = 0;
    updateLastStats(null);
    setInput('');
    setStatus('Waiting for response...');

    // Thinking uses the same completed-line gating as the answer below: its
    // block otherwise re-renders in full every 50ms tick, which flickers just
    // as badly on long reasoning. Turn-local, so it resets with each submit;
    // a buffer that shrank (a segment was flushed inline) re-arms it.
    const thinkingFlushed = { length: 0, atMs: 0 };
    const flushInterval = setInterval(() => {
      setActivityTick((tick) => tick + 1);
      const t = thinkingRef.current;
      if (t.buffer.length < thinkingFlushed.length) {
        thinkingFlushed.length = 0;
        thinkingFlushed.atMs = 0;
      }
      if (t.buffer && t.buffer.length !== thinkingFlushed.length) {
        const now = Date.now();
        const sinceMs = now - thinkingFlushed.atMs;
        const lineDone = t.buffer.indexOf('\n', thinkingFlushed.length) !== -1;
        if ((lineDone && sinceMs >= 100) || sinceMs >= 500) {
          thinkingFlushed.length = t.buffer.length;
          thinkingFlushed.atMs = now;
          setStreamingThinking(t.buffer);
        }
      }
      if (t.durationMs !== null) setThinkingDuration(t.durationMs);

      // Push the live markdown tail only on a completed line, and at most
      // ~10×/sec. A long line with no newline still advances via the staleness
      // fallback so the block never looks frozen. Whatever hasn't flushed yet is
      // captured and committed verbatim when the turn ends, so nothing is lost.
      const cBuf = streamingBufferRef.current;
      const flushed = contentFlushRef.current;
      if (cBuf && cBuf.length !== flushed.length) {
        const now = Date.now();
        const sinceFlushMs = now - flushed.atMs;
        const newlineArrived = cBuf.indexOf('\n', flushed.length) !== -1;
        if ((newlineArrived && sinceFlushMs >= 100) || sinceFlushMs >= 500) {
          // Long answers: once the live block is big, commit everything up to
          // its last safe paragraph boundary as an inline message. Committed
          // text renders once (concealed markers) and never re-lays-out; only
          // the small tail keeps streaming, which kills the flicker of
          // re-rendering the whole growing block on every flush. The real
          // message replaces these optimistic chunks when the turn commits.
          if (cBuf.length >= LIVE_BLOCK_COMMIT_CHARS) {
            const splitAt = safeStreamCommitPoint(cBuf);
            if (splitAt !== null && splitAt >= LIVE_BLOCK_COMMIT_CHARS / 2) {
              const committed = cBuf.slice(0, splitAt);
              streamingBufferRef.current = cBuf.slice(splitAt);
              contentFlushRef.current = { length: 0, atMs: now };
              setStreamingContent(streamingBufferRef.current);
              setConversation((prev) =>
                prev
                  ? {
                      ...prev,
                      messages: [
                        ...prev.messages,
                        createMessage('assistant', committed),
                      ],
                    }
                  : prev
              );
              return;
            }
          }
          contentFlushRef.current = { length: cBuf.length, atMs: now };
          setStreamingContent(cBuf);
        }
      }
    }, 50);

    const requestApproval = (
      request: ToolApprovalRequest
    ): Promise<boolean> => {
      if (autoApproveRef.current) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        setStatus('Awaiting approval...');
        setPendingApproval({ request, resolve });
      });
    };

    const requestUserInput = (
      request: UserQuestionRequest
    ): Promise<string> => {
      return new Promise<string>((resolve) => {
        setStatus('Waiting for your answer...');
        setPendingQuestion({ request, resolve });
      });
    };

    const onToolActivity = (event: ToolActivityEvent): void => {
      if (event.phase === 'start') {
        // A tool call is the model's first output for turns that act before they
        // speak (no streamed prose/thinking). Mark first-token here too, so TTFT
        // settles instead of climbing like a stopwatch for the whole turn.
        if (responseTimingRef.current.firstTokenMs === null) {
          responseTimingRef.current.firstTokenMs = Date.now();
        }
        // Preserve transcript order: commit the reasoning and prose that
        // streamed before this tool as inline blocks (thinking → prose → tool),
        // so they keep their place instead of trailing the tool.
        flushStreamedThinking();
        flushStreamedText();

        const callId = event.toolCallId;
        // Stash the rendered diff (file tools) so it shows inline in place.
        if (event.view.diff) {
          const rendered = renderDiff(event.view.diff);
          setLiveToolDiffs((prev) => ({ ...prev, [callId]: rendered }));
        }

        // Splice an optimistic assistant(tool call) + tool(running) pair so the
        // tool renders in place immediately rather than in a trailing block.
        // todowrite already knows its full text (describe rendered it into the
        // preview), so show it now; every other tool shows empty (= running)
        // until its 'end' fills the result. The real messages replace these
        // optimistic ones when the turn commits.
        const initialContent =
          event.toolName === 'todowrite' ? (event.view.preview ?? '') : '';
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
                        name: event.toolName,
                        arguments: event.arguments,
                      },
                    ],
                  }),
                  createMessage('tool', initialContent, new Date(), undefined, {
                    toolCallId: callId,
                    name: event.toolName,
                  }),
                ],
              }
            : prev
        );
        return;
      }

      // phase === 'end': fill the optimistic result in place with the output.
      // An empty result reads as "running", so bash-style "(no output)" keeps a
      // finished call visibly done.
      const callId = event.toolCallId;
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
    };

    // Update the metrics line as each model response arrives, instead of waiting
    // for the whole (possibly multi-step) turn to finish. `stepUsage` is this
    // response's usage, not the running total, so we accumulate it.
    const onUsage = (stepUsage: TokenUsage): void => {
      turnReportedUsage = true;
      const pricing = activeModelInfo?.pricing;
      const requestCost =
        stepUsage.cost ??
        (pricing
          ? stepUsage.inputTokens * pricing.inputPerToken +
            stepUsage.outputTokens * pricing.outputPerToken +
            stepUsage.cachedTokens *
              (pricing.cacheReadPerToken ?? pricing.inputPerToken)
          : 0);
      updateMetrics((prev) => ({
        inputTokens: prev.inputTokens + stepUsage.inputTokens,
        outputTokens: prev.outputTokens + stepUsage.outputTokens,
        cachedTokens: prev.cachedTokens + stepUsage.cachedTokens,
        cost: prev.cost + requestCost,
        lastInputTokens: stepUsage.inputTokens,
      }));
    };

    // Set on turn success so the auto-compact check below the try/finally (it
    // must run after the request controller is released) sees the fresh
    // conversation rather than the not-yet-committed state.
    let completedConversation: Conversation | null = null;
    try {
      const attachments =
        await props.promptAttachmentService.resolveAttachments(
          cleanedValue,
          requestController.signal
        );
      const turnModel = activeModel || session.activeModel;
      const turnProvider = activeModelInfo?.providerId ?? activeProviderId;
      const turnEffort = effectiveEffort(
        activeModelInfo?.reasoning,
        turnProvider
          ? reasoningEffortByModelRef.current[turnProvider]?.[turnModel]
          : undefined
      );
      const result = await props.chatSessionService.submitMessage({
        conversation: baseConversation,
        model: turnModel,
        ...(turnEffort ? { reasoningEffort: turnEffort } : {}),
        ...(activeModelInfo?.reasoning?.mandatory
          ? { reasoningMandatory: true }
          : {}),
        content: cleanedValue,
        ...(turnImages.length ? { images: turnImages } : {}),
        attachments,
        signal: requestController.signal,
        requestApproval,
        requestUserInput,
        onUsage,
        onToolActivity,
        drainSteering: () => {
          const queued = queuedMessagesRef.current;
          if (queued.length === 0) return null;
          const combined = queued.join('\n\n');
          // Clear the queue and surface the steering message in the transcript
          // now, so it's visibly part of the conversation before the model's
          // next round-trip (the committed turn replaces it at the end).
          setQueuedMessages([]);
          // Commit any prose streamed so far first, so the steering message
          // lands after it rather than before the in-progress answer.
          flushStreamedText();
          setConversation((prev) =>
            prev
              ? {
                  ...prev,
                  messages: [...prev.messages, createMessage('user', combined)],
                }
              : prev
          );
          return combined;
        },
        onTitle: (sessionId, title) => {
          setConversation((prev) =>
            prev && prev.sessionId === sessionId ? { ...prev, title } : prev
          );
        },
        onToken: (token) => {
          if (responseTimingRef.current.firstTokenMs === null) {
            responseTimingRef.current.firstTokenMs = Date.now();
          }
          // First answer token after a thinking segment: commit that segment
          // inline so it settles above the streaming answer instead of growing
          // at the bottom alongside it.
          if (thinkingRef.current.buffer) {
            flushStreamedThinking();
          }
          streamingBufferRef.current += token;
          turnOutputCharsRef.current += token.length;
        },
        onThinkingToken: (token) => {
          if (responseTimingRef.current.firstTokenMs === null) {
            responseTimingRef.current.firstTokenMs = Date.now();
          }
          if (!thinkingRef.current.startMs) {
            thinkingRef.current.startMs = Date.now();
          }
          thinkingRef.current.buffer += token;
          turnOutputCharsRef.current += token.length;
        },
      });

      const endMs = Date.now();
      const timing = responseTimingRef.current;
      // Commit any thinking still buffered (e.g. the turn ended on reasoning with
      // no following answer token) so every segment is accounted for, then anchor
      // each segment to the assistant message it preceded — segment i → the i-th
      // assistant message of the turn — keeping the order thinking → tool use /
      // answer for each round rather than dumping it all on the first message.
      if (thinkingRef.current.buffer.trim()) {
        thinkingSegmentsRef.current.push({
          content: thinkingRef.current.buffer,
          durationMs:
            thinkingRef.current.durationMs ??
            (thinkingRef.current.startMs
              ? Date.now() - thinkingRef.current.startMs
              : 0),
        });
      }
      const thinkingSegments = thinkingSegmentsRef.current;
      const newMessages = result.conversation.messages.slice(
        baseConversation.messages.length
      );
      const assistantMessages = newMessages.filter(
        (message) => message.role === 'assistant'
      );
      const capturedContent = streamingBufferRef.current;
      const capturedGenerationMs = Math.max(
        endMs - (timing.firstTokenMs ?? endMs),
        0
      );
      const estimatedTurnOutputTokens = estimateTokenCount(
        thinkingSegments.map((segment) => segment.content).join('') +
          capturedContent
      );
      // Token/cost accounting is driven live by onUsage; here we only need the
      // output count for the TTFT/throughput stats, falling back to an estimate
      // when the provider didn't report usage.
      const turnOutputTokens =
        result.usage?.outputTokens ?? estimatedTurnOutputTokens;
      clearInterval(flushInterval);
      streamingBufferRef.current = '';
      thinkingRef.current = { buffer: '', startMs: 0, durationMs: null };
      thinkingSegmentsRef.current = [];

      startTransition(() => {
        setStreamingContent('');
        setStreamingThinking('');
        setThinkingDuration(null);
        // The title is async metadata delivered via onTitle, so a turn result
        // may not carry it yet. Keep any title we already have instead of
        // reverting the label back to the session uuid.
        setConversation((prev) => {
          const mergedConversation =
            result.conversation.title || !prev?.title
              ? result.conversation
              : { ...result.conversation, title: prev.title };

          if (!expandTools || !prev) {
            return mergedConversation;
          }

          const previousToolMessagesByCallId = new Map(
            prev.messages
              .filter(
                (message) =>
                  message.role === 'tool' &&
                  message.toolCallId &&
                  message.content !== ''
              )
              .map((message) => [message.toolCallId as string, message.content])
          );

          return {
            ...mergedConversation,
            messages: mergedConversation.messages.map((message) =>
              message.role === 'tool' &&
              message.toolCallId &&
              previousToolMessagesByCallId.has(message.toolCallId)
                ? {
                    ...message,
                    content:
                      previousToolMessagesByCallId.get(message.toolCallId) ??
                      message.content,
                  }
                : message
            ),
          };
        });
        setStatus('Ready');
        // Flip `isSending` off inside the same transition that commits the final
        // conversation, so they land in one render. If this were left to the
        // urgent `finally` below, React would apply it before this low-priority
        // commit, briefly exposing isSending=false against the stale (pre-commit)
        // conversation — and the post-turn queue-flush effect would then submit a
        // queued message against that stale snapshot, dropping the just-finished
        // reply and floating the new message up out of order.
        setIsSending(false);
        if (assistantMessages.length && thinkingSegments.length) {
          const anchored: Record<
            string,
            { content: string; durationMs: number }
          > = {};
          thinkingSegments.forEach((segment, index) => {
            const target =
              assistantMessages[Math.min(index, assistantMessages.length - 1)];
            if (!target) return;
            const existing = anchored[target.id];
            anchored[target.id] = existing
              ? {
                  content: `${existing.content}\n\n${segment.content}`,
                  durationMs: existing.durationMs + segment.durationMs,
                }
              : segment;
          });
          setMessageThinking((prev) => ({ ...prev, ...anchored }));
        }
        if (timing.firstTokenMs !== null) {
          const ttftMs = timing.firstTokenMs - timing.startMs;
          const genSeconds = Math.max(capturedGenerationMs, 1) / 1000;
          const turnTokensPerSecond = turnOutputTokens / genSeconds;
          // Fold this turn's rate into the running average:
          // avg += (sample − avg) / count.
          const running = tokensPerSecondAvgRef.current;
          running.count += 1;
          running.avg += (turnTokensPerSecond - running.avg) / running.count;
          updateLastStats({
            ttftMs,
            tokensPerSecond: turnTokensPerSecond,
            avgTokensPerSecond: running.avg,
          });
        }
        // When the turn reported usage, the metrics line was already updated
        // live via onUsage (per response), so don't add it again here. Only when
        // no usage came back at all do we fall back to an output estimate.
        if (!turnReportedUsage) {
          updateMetrics((prev) => ({
            inputTokens: prev.inputTokens,
            outputTokens: prev.outputTokens + turnOutputTokens,
            cachedTokens: prev.cachedTokens,
            cost: prev.cost,
            lastInputTokens: prev.lastInputTokens,
          }));
        }
      });
      // The startTransition callback ran synchronously, so the refs already
      // hold this turn's final values — persist them with the conversation.
      persistSessionStats(result.conversation.sessionId);
      completedConversation = result.conversation;
    } catch (caughtError: unknown) {
      clearInterval(flushInterval);
      setPendingApproval(null);
      // Drop any unanswered question; its promise was already rejected via the
      // abort signal (or the request failed), so there's nothing to resolve.
      setPendingQuestion(null);

      if (isAbortError(caughtError)) {
        // The service persists everything an interrupted turn produced — the
        // user message, completed tool rounds, per-step thinking, and the
        // partial answer that was streaming — and attaches the saved
        // conversation to the abort error. Adopt it so the transcript matches
        // what's on disk and the interrupted work survives a restart.
        const interruptedConversation = getInterruptedConversation(caughtError);
        if (interruptedConversation) {
          setConversation((current) =>
            current?.title && !interruptedConversation.title
              ? { ...interruptedConversation, title: current.title }
              : interruptedConversation
          );
        } else {
          // Fallback (e.g. the persist itself failed): keep the partial in
          // memory from the streaming buffers, as before.
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
        }

        streamingBufferRef.current = '';
        thinkingRef.current = { buffer: '', startMs: 0, durationMs: null };
        setStreamingContent('');
        setStreamingThinking('');
        setThinkingDuration(null);
        setError(null);
        setStatus('Interrupted');
        // Put the interrupted prompt back so the user can tweak and resend.
        interruptedPromptRef.current = submittedPromptRef.current || null;
        // Keep whatever usage the completed steps reported before the interrupt.
        persistSessionStats(baseConversation.sessionId);
      } else {
        streamingBufferRef.current = '';
        thinkingRef.current = { buffer: '', startMs: 0, durationMs: null };
        setStreamingContent('');
        setStreamingThinking('');
        setThinkingDuration(null);
        setError(getErrorMessage(caughtError));
        setStatus('Request failed');
      }
      // Urgent, same as the conversation update on the error/abort paths above, so
      // they commit together — isSending never flips against a stale conversation.
      setIsSending(false);
    } finally {
      // Keep liveToolDiffs: they're keyed by tool-call id, which the committed
      // messages share, so a write/edit keeps showing its diff in the
      // transcript after the turn (cleared only when the session resets).
      activeRequestControllerRef.current = null;
    }

    // Auto-compact: when this turn's request used at least the configured
    // share of the model's context window, compact now so the next message
    // starts from the summary. Only after a successful turn — never mid-turn
    // or off an interrupted one — and only when the window size is known.
    // Within 5 points below the threshold, warn instead, so the compaction
    // pause never comes as a surprise.
    const threshold = autoCompactThresholdRef.current;
    const contextWindow = activeModelInfo?.contextWindow;
    if (
      completedConversation &&
      threshold > 0 &&
      contextWindow != null &&
      contextWindow > 0
    ) {
      const pct = contextPct(metricsRef.current.lastInputTokens, contextWindow);
      if (pct >= threshold) {
        await runCompaction('auto', completedConversation);
      } else {
        // Escalating heads-up as the threshold approaches: once at 5 points
        // left, then again at 3, 2, and 1. Each milestone flashes once.
        const milestone = autoCompactWarnMilestone(threshold - pct);
        if (
          milestone !== null &&
          (autoCompactWarnedMilestoneRef.current === null ||
            milestone < autoCompactWarnedMilestoneRef.current)
        ) {
          autoCompactWarnedMilestoneRef.current = milestone;
          flashCommandNotice(
            new StyledText([
              tc('Context ', { fg: MUTED }),
              tc(`${contextBar(pct)} ${pct}%`, {
                fg: contextUsageColor(pct),
              }),
              tc(
                ` — auto-compact triggers at >=${threshold}% (/compact to run it now)`,
                { fg: MUTED }
              ),
            ])
          );
        }
      }
    }
  };

  if (showModelPicker) {
    return (
      <ModelPicker
        models={connectModels ?? allModels}
        currentModel={activeModel}
        currentProviderId={activeModelInfo?.providerId ?? activeProviderId}
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

  if (showReasoningPicker && activeModelInfo?.reasoning?.effortLevels.length) {
    const providerId = activeModelInfo.providerId;
    return (
      <ReasoningPicker
        model={activeModelInfo}
        current={reasoningEffortByModel[providerId]?.[activeModel]}
        onSelect={(effort) => {
          setShowReasoningPicker(false);
          setReasoningEffortByModel((prev) => ({
            ...prev,
            [providerId]: { ...prev[providerId], [activeModel]: effort },
          }));
          props.onReasoningEffortChange?.(providerId, activeModel, effort);
          setStatus(
            effort === 'off'
              ? `Reasoning off for ${activeModelInfo.displayName}`
              : `Reasoning effort for ${activeModelInfo.displayName} set to ${effort}`
          );
        }}
        onCancel={() => setShowReasoningPicker(false)}
      />
    );
  }

  if (showToolsPicker && props.manageableTools?.length) {
    const tools = props.manageableTools.map((tool) => ({
      ...tool,
      enabled: !disabledTools.includes(tool.name),
    }));
    return (
      <ToolsPicker
        tools={tools}
        onConfirm={(disabledNames) => {
          setShowToolsPicker(false);
          setDisabledTools(disabledNames);
          props.onDisabledToolsChange?.(disabledNames);
          const offCount = disabledNames.length;
          setStatus(
            offCount === 0
              ? 'All tools enabled'
              : `${offCount} tool${offCount === 1 ? '' : 's'} disabled`
          );
        }}
        onCancel={() => setShowToolsPicker(false)}
      />
    );
  }

  if (showModePicker) {
    return (
      <ModePicker
        modes={modes}
        activeModeId={activeMode}
        onSelect={(modeId) => {
          setShowModePicker(false);
          const mode = modes.find((m) => m.id === modeId);
          setActiveMode(modeId);
          props.onModeChange?.(modeId);
          setStatus(`Mode: ${mode?.name ?? modeId}`);
        }}
        onCreate={(name, systemPrompt) => {
          const result = props.onCreateMode?.(name, systemPrompt);
          setShowModePicker(false);
          if (!result) {
            setStatus('Could not create mode');
            return;
          }
          setModes(result.modes);
          setActiveMode(result.modeId);
          const created = result.modes.find((m) => m.id === result.modeId);
          setStatus(`Mode: ${created?.name ?? name}`);
        }}
        onCancel={() => setShowModePicker(false)}
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

  if (showResetPicker) {
    return (
      <ResetPicker
        onConfirm={() => {
          // Reset the same directory the runtime reads from (honors
          // JUSTCODE_CACHE_DIR) so the subsequent onReloadMcp sees the wiped
          // mcp.json instead of a stale copy in the default cache path.
          const configDirectory = props.configDirectory;
          void resetAppState(configDirectory)
            .then(() => {
              // `mcp.json` is gone now, so reloading disconnects every running
              // server and drops its tools from the live registry — no restart.
              void props.onReloadMcp?.();
              const resetConfig = {
                systemPrompt: DEFAULT_SYSTEM_PROMPT,
              };
              props.onConfigReset(resetConfig);
              setSavedConfig(resetConfig);
              setBaseProviders([]);
              setConnectedProviders([]);
              setConnectModels(null);
              setAllModels([]);
              setActiveProviderId(undefined);
              setActiveModel('');
              setActiveModelInfo(null);
              setShowModelPicker(false);
              setShowSessionPicker(false);
              setShowResetPicker(false);
              setShowConnectPicker(true);
              resetFreshSessionState();
              nextSessionRequestedModelRef.current = undefined;
              setSessionSummaries([]);
              setSessionSummariesLoading(false);
              setConversation(null);
              setSession(null);
              setInputWithCursorAtEnd('');
              const newId = randomUUID();
              setCurrentSessionId(newId);
              setStatus('Reset complete · connect a provider to continue');
            })
            .catch((caughtError: unknown) => {
              setShowResetPicker(false);
              setError(getErrorMessage(caughtError));
            });
        }}
        onCancel={() => {
          setShowResetPicker(false);
        }}
      />
    );
  }

  if (showClearSessionsPicker) {
    return (
      <ClearSessionsPicker
        count={sessionsToDeleteCount}
        onConfirm={() => {
          const ids = sessionsToDeleteRef.current;
          void Promise.allSettled(
            ids.map((id) => props.chatSessionService.clearSession(id))
          )
            .then(() => {
              // The active session may have been among those deleted; drop into
              // a fresh one so the transcript doesn't reference cleared history.
              resetFreshSessionState();
              setSessionSummaries([]);
              setShowClearSessionsPicker(false);
              const newId = randomUUID();
              nextSessionRequestedModelRef.current =
                activeModel || props.requestedModel;
              setCurrentSessionId(newId);
              setStatus(
                `Deleted ${ids.length} session${ids.length === 1 ? '' : 's'}`
              );
            })
            .catch((caughtError: unknown) => {
              setShowClearSessionsPicker(false);
              setError(getErrorMessage(caughtError));
            });
        }}
        onCancel={() => {
          setShowClearSessionsPicker(false);
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
      // Fill the whole view with the app background so the light-on-dark UI
      // stays readable on light/white terminals (OpenTUI only paints cells a
      // component draws, so a full-size root box is what actually covers it).
      backgroundColor={APP_BG}
      padding={1}
      // Clicking anywhere in the app puts the caret back in the prompt, so
      // typing resumes without hunting for the input. On mouse-up (bubbled from
      // whatever was clicked) rather than mouse-down so it never fights a
      // child's own click handling, and skipped in the modes that deliberately
      // steer focus away from the prompt (browse/queue-edit/approval).
      onMouseUp={() => {
        if (
          browseIndex !== null ||
          queueEditIndex !== null ||
          pendingApproval !== null
        ) {
          return;
        }
        const area = promptAreaRef.current;
        if (area && !area.isDestroyed && !area.focused) {
          area.focus();
        }
      }}
    >
      <box flexDirection="column" flexShrink={0}>
        <text
          flexShrink={0}
          content={
            new StyledText([
              tc(`${APP_NAME} `, { fg: 'cyan' }),
              tc(`v${props.version}`, { fg: MUTED }),
            ])
          }
        />
        {props.updateNotice ? (
          <text
            flexShrink={0}
            content={
              new StyledText([
                tc(`Update available: v${props.updateNotice.latestVersion} `, {
                  fg: 'yellow',
                }),
                tc(`— ${props.updateNotice.upgradeCommand}`, { fg: MUTED }),
              ])
            }
          />
        ) : null}
        <text fg={MUTED} flexShrink={0}>
          Dir: {process.cwd()}
        </text>
        <text fg={MUTED} flexShrink={0}>
          Provider: {activeProviderId} | Session: {currentSessionLabel}
        </text>
        <text fg={MUTED} flexShrink={0}>
          Enter to send · \ + Enter (or Ctrl/Shift+Enter) for newline · Tab to
          complete @file (or @file::method) or /command · Esc to cancel or
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
          // Compacted-away epochs render first, so the full transcript stays
          // visible; each epoch's summary message draws a divider above itself.
          [
            ...(conversation.previousMessages ?? []),
            ...conversation.messages,
          ].map((message) => {
            // Collapse mode: render only the user's messages so the transcript
            // is just what was asked, without the model's replies in between.
            if (collapseResponses && message.role !== 'user') {
              return null;
            }
            // A compaction summary opens a new epoch: draw a divider and render
            // the summary muted and left-aligned — it's carried-over context,
            // not something the user typed.
            if (message.isCompactSummary) {
              return (
                <box key={message.id} flexDirection="column" marginY={1}>
                  <text fg="cyan">─── Conversation compacted ───</text>
                  <MarkdownView content={message.content} muted />
                  <text fg={MUTED}>{formatTime(message.createdAt)}</text>
                </box>
              );
            }
            const thinking =
              message.role === 'assistant'
                ? (message.thinking ?? messageThinking[message.id])
                : undefined;
            return (
              <box
                key={message.id}
                flexDirection="column"
                // User messages (and their attachments) hug the right edge,
                // mirroring the extension, so it's clear which messages are
                // the user's. The padding keeps the text off the scrollbar.
                {...(message.role === 'user'
                  ? { alignItems: 'flex-end' as const, paddingRight: 2 }
                  : {})}
              >
                {thinking ? (
                  <box flexDirection="column" marginBottom={0}>
                    <text fg="yellow">
                      {thinkingCollapsed ? '+ ' : ''}Thought:{' '}
                      {formatDuration(thinking.durationMs)}
                    </text>
                    {thinkingCollapsed ? null : (
                      <MarkdownView content={thinking.content} muted />
                    )}
                  </box>
                ) : null}
                {message.role === 'user' ? (
                  <box
                    flexDirection="column"
                    alignItems="flex-end"
                    border={['right']}
                    borderStyle="rounded"
                    borderColor="cyan"
                    paddingRight={1}
                    marginY={1}
                  >
                    {/* An image-only message has no prose — skip the empty
                        line so the bubble doesn't render a blank row. */}
                    {message.content ? (
                      <text fg="white" attributes={BOLD}>
                        {message.content}
                      </text>
                    ) : null}
                    <text fg={MUTED}>{formatTime(message.createdAt)}</text>
                  </box>
                ) : message.role === 'assistant' ? (
                  <box flexDirection="column">
                    {message.content &&
                    !(thinking && message.toolCalls?.length) ? (
                      <MarkdownView content={message.content} />
                    ) : null}
                    {/* bash, todowrite, and present_plan render their own boxes
                        below, so skip them here to avoid a redundant ⚙ line. */}
                    {message.toolCalls
                      ?.filter(
                        (call) =>
                          call.name !== 'bash' &&
                          call.name !== 'todowrite' &&
                          call.name !== 'present_plan'
                      )
                      .map((call) => (
                        <text key={call.id} fg="magenta">
                          ⚙ {call.name}({summarizeToolArgs(call.arguments)})
                        </text>
                      ))}
                    {/* When the LLM received the request that produced this
                        reply — only under the final answer of a turn, not
                        every tool-call step. */}
                    {message.llmReceivedAt &&
                    message.content &&
                    !message.toolCalls?.length ? (
                      <text fg={MUTED}>
                        {formatTime(message.llmReceivedAt)}
                      </text>
                    ) : null}
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
                  ) : message.name === 'todowrite' ? (
                    <TodoBlock content={message.content} />
                  ) : message.name === 'present_plan' ? (
                    <PlanBlock content={message.content} />
                  ) : (
                    <ToolResultInline
                      content={message.content}
                      expanded={expandTools}
                      diff={
                        message.toolCallId
                          ? liveToolDiffs[message.toolCallId]
                          : undefined
                      }
                    />
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
                {/* No emoji here: double-width glyphs are measured as one
                    column, which clips the right-aligned line at the edge. */}
                {message.images?.length ? (
                  <text fg={MUTED}>
                    {message.images.length} image
                    {message.images.length === 1 ? '' : 's'} attached
                  </text>
                ) : null}
              </box>
            );
          })
        ) : (
          <text fg={MUTED}>No messages yet.</text>
        )}
        {!collapseResponses && (streamingThinking || streamingContent) ? (
          <box flexDirection="column">
            {streamingThinking ? (
              <box flexDirection="column">
                {thinkingDuration !== null ? (
                  <text fg="yellow">
                    {`${thinkingCollapsed ? '+ ' : ''}Thought: ${formatDuration(thinkingDuration)}`}
                  </text>
                ) : (
                  <box flexDirection="row">
                    <text fg="yellow">thinking </text>
                    <Spinner fg="yellow" />
                  </box>
                )}
                {thinkingCollapsed ? null : (
                  <MarkdownView content={streamingThinking} live muted />
                )}
              </box>
            ) : null}
            {streamingContent ? (
              <MarkdownView content={streamingContent} live />
            ) : null}
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
                    commandWindowStart + index === selectedCommandIndex,
                    {
                      thinkingCollapsed,
                      autoApprove,
                      localModelAutoRefresh,
                      modelAutoRefresh,
                      lazyToolLoading,
                      expandTools,
                      maxReadLines,
                      maxHistoryMessages,
                      autoCompactThresholdPercent: autoCompactThreshold,
                      reasoning: {
                        supported: Boolean(
                          activeModelInfo?.reasoning?.effortLevels.length
                        ),
                        effort: effectiveEffort(
                          activeModelInfo?.reasoning,
                          activeModelInfo
                            ? reasoningEffortByModel[
                                activeModelInfo.providerId
                              ]?.[activeModel]
                            : undefined
                        ),
                      },
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

        {showJumpToBottom || showJumpToTop ? (
          <box marginTop={1} flexDirection="row" justifyContent="center">
            {showJumpToTop ? (
              <box
                paddingX={1}
                marginRight={showJumpToBottom ? 2 : 0}
                backgroundColor={INPUT_BG}
                onMouseDown={scrollToTop}
              >
                <text fg="cyan">↑ Jump to top</text>
              </box>
            ) : null}
            {showJumpToBottom ? (
              <box
                paddingX={1}
                backgroundColor={INPUT_BG}
                onMouseDown={scrollToBottom}
              >
                <text fg="cyan">↓ Jump to bottom</text>
              </box>
            ) : null}
          </box>
        ) : null}

        {pendingQuestion ? (
          <box
            marginTop={1}
            flexShrink={0}
            flexDirection="column"
            border
            borderStyle="rounded"
            borderColor="yellow"
            paddingX={1}
          >
            <text fg="yellow" attributes={BOLD}>
              {pendingQuestion.request.question}
            </text>
            {pendingQuestion.request.options?.length
              ? pendingQuestion.request.options.map((option, index) => (
                  <text key={index} fg={MUTED}>
                    {`  ${index + 1}. ${option}`}
                  </text>
                ))
              : null}
            <text fg={MUTED}>
              Type your answer below and press Enter
              {pendingQuestion.request.options?.length
                ? ' (or the option number)'
                : ''}
              .
            </text>
          </box>
        ) : null}

        {queuedMessages.length > 0 ? (
          <box
            marginTop={1}
            flexShrink={0}
            flexDirection="column"
            border
            borderStyle="rounded"
            borderColor={queueEditIndex !== null ? 'cyan' : MUTED}
            paddingX={1}
          >
            <text fg={MUTED}>
              {queueEditIndex !== null
                ? 'editing queue · ↑/↓ select · enter to edit · esc back'
                : `${queuedMessages.length} queued message${
                    queuedMessages.length === 1 ? '' : 's'
                  } · steering the model · ↑ to edit`}
            </text>
            {queuedMessages.map((message, index) => (
              <text
                key={index}
                content={
                  new StyledText([
                    tc(index === queueEditIndex ? '› ' : '  ', {
                      fg: index === queueEditIndex ? 'cyan' : MUTED,
                    }),
                    tc(firstLine(message), {
                      fg: index === queueEditIndex ? 'cyan' : 'white',
                    }),
                  ])
                }
              />
            ))}
          </box>
        ) : null}

        {/* Claude Code-style prompt: a thin rounded border on the app
            background with a "❯"-style marker, instead of a filled block. */}
        <box
          marginTop={1}
          width="100%"
          flexDirection="row"
          border
          borderStyle="rounded"
          borderColor={INPUT_BORDER}
          paddingX={1}
        >
          <text fg={MUTED} flexShrink={0}>
            {'> '}
          </text>
          <textarea
            key={inputKey}
            initialValue={input}
            flexGrow={1}
            flexShrink={1}
            minHeight={1}
            maxHeight={6}
            wrapMode="word"
            placeholder={modePlaceholder(activeMode)}
            backgroundColor={APP_BG}
            textColor={MARKDOWN_FG}
            focusedTextColor="white"
            placeholderColor={MUTED}
            cursorColor="white"
            // A terminal forwards a paste over stdin, but pasted image data is
            // not part of it — so when a paste carries no text, check the OS
            // clipboard for an image and attach it instead of inserting nothing.
            onPaste={(event: {
              bytes?: Uint8Array;
              preventDefault: () => void;
            }) => {
              if (event.bytes && event.bytes.length > 0) return;
              if (attachClipboardImage()) {
                event.preventDefault();
              }
            }}
            // The prompt stays focusable while a turn is sending (so the user
            // can type ahead and queue the next message) and while a question is
            // pending (it doubles as the answer box). The keyboard browse/edit
            // modes steer focus away to drive their arrow navigation, and a
            // pending tool approval takes focus too: it's answered with single
            // keys (y/a/n) via the global handler, so leaving the textarea
            // focused would echo those keystrokes into the input.
            focused={
              terminalFocused &&
              browseIndex === null &&
              queueEditIndex === null &&
              pendingApproval === null
            }
            onSubmit={() => {
              const text = promptAreaRef.current?.plainText ?? input;
              if (pendingQuestion) {
                resolveQuestion(text);
                return;
              }
              void submit(text);
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

                // Universal newline fallback for terminals that can't report a
                // modified Enter (e.g. macOS Terminal.app sends a bare CR for
                // Ctrl+Enter, indistinguishable from plain Enter): a backslash
                // immediately before the cursor turns Enter into a newline
                // instead of a submit. Works regardless of key reporting.
                const text = promptArea.plainText;
                const cursor = promptArea.cursorOffset;
                if (cursor > 0 && text[cursor - 1] === '\\') {
                  promptArea.setText(
                    `${text.slice(0, cursor - 1)}\n${text.slice(cursor)}`
                  );
                  promptArea.cursorOffset = cursor;
                  return;
                }

                if (pendingQuestion) {
                  resolveQuestion(promptArea.plainText);
                  return;
                }

                void submit(promptArea.plainText);
              }
            }}
            onContentChange={() => {
              const promptArea = promptAreaRef.current;
              if (!promptArea || promptArea.isDestroyed) return;
              // Mark this change as originating from the buffer so the sync
              // effect doesn't write the (possibly stale) React value back.
              inputFromAreaRef.current = true;
              setInput(promptArea.plainText);
              reconcilePendingImages(promptArea.plainText);
            }}
            ref={(next) => {
              promptAreaRef.current = next;
            }}
          />
        </box>

        {!isCommandMode && showSymbolSuggestions ? (
          <box marginTop={1} flexDirection="column">
            <text fg={MUTED}>methods in {activeSymbolMention?.path}:</text>
            {symbolSuggestions.map((suggestion, index) => (
              <text
                key={suggestion}
                {...(index === selectedSuggestionIndex ? { fg: 'cyan' } : {})}
              >
                {index === selectedSuggestionIndex ? '>' : ' '} ::{suggestion}
              </text>
            ))}
            {symbolSuggestions.length === 0 ? (
              <text fg={MUTED}>no method found</text>
            ) : null}
          </box>
        ) : !isCommandMode && showMentionSuggestions ? (
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
            {reasoningAvailable ? (
              <text fg="yellow" attributes={BOLD} wrapMode="none">
                {` ${activeReasoningEffort ?? 'off'}`}
              </text>
            ) : null}
            <text fg="magenta" attributes={BOLD} wrapMode="none">
              {activeModeIcon
                ? ` ${activeModeIcon} ${activeModeName}`
                : ` ${activeModeName}`}
            </text>
            {modes.length > 1 ? (
              <text fg={MUTED} wrapMode="none">
                {' (shift+tab)'}
              </text>
            ) : null}
            {showInterruptHint ? (
              <text fg={MUTED}> · Press Esc to interrupt</text>
            ) : null}
          </box>
        </box>
        <box marginTop={1}>
          <text content={metricsLineContent(metrics, activeModelInfo)} />
        </box>
        <box marginTop={1} flexDirection="row" justifyContent="flex-end">
          {/* The copied flash briefly takes over the notification slot, then the
              usual stats/status content returns when the timer clears it. */}
          {copiedNotice ? (
            <text content={statusLineContent('✓ Copied to clipboard')} />
          ) : commandNotice ? (
            <text
              content={
                typeof commandNotice === 'string'
                  ? statusLineContent(commandNotice)
                  : commandNotice
              }
            />
          ) : displayStats ? (
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
    </box>
  );
}

/**
 * Inline rendering of a finished bash call in the transcript: a one-line
 * summary that, when expanded, opens a box with the command and its output
 * split by a horizontal rule. Selection (while browsing) tints it cyan.
 */
const BashResult = React.memo(function BashResult({
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
});

/**
 * Inline transcript rendering of a non-bash tool result. Mirrors bash: when
 * /expand-tools is on, the full result is shown in a box (capped like bash);
 * otherwise it collapses to a one-line `↳` summary. The tool name + arguments
 * are already shown by the assistant message's `⚙` line above this.
 */
const ToolResultBlock = React.memo(function ToolResultBlock({
  content,
  expanded,
}: {
  content: string;
  expanded: boolean;
}): React.ReactNode {
  // Empty content means the call hasn't finished (a finished call always has
  // non-empty content, e.g. "(no output)").
  if (content === '') {
    return <text fg={MUTED}>{'  ↳ running…'}</text>;
  }
  if (!expanded) {
    return (
      <text fg={MUTED}>
        {'  ↳ '}
        {firstLine(content)}
      </text>
    );
  }
  return (
    <box
      flexDirection="column"
      marginLeft={2}
      border
      borderStyle="rounded"
      borderColor="gray"
      paddingX={1}
    >
      <text content={ansiToStyledText(truncatePreview(content))} />
    </box>
  );
});

/**
 * Inline tool result, with the change diff when the tool produced one (writes,
 * edits, patches). With /expand-tools on, the diff is shown (that's "what it
 * wrote") above a one-line result summary; otherwise it collapses like any
 * other tool to the one-line `↳` summary.
 */
const ToolResultInline = React.memo(function ToolResultInline({
  content,
  expanded,
  diff,
}: {
  content: string;
  expanded: boolean;
  diff?: string | undefined;
}): React.ReactNode {
  if (diff) {
    const running = content === '';
    const showDiff = running || expanded;

    if (showDiff) {
      return (
        <box flexDirection="column">
          <box marginLeft={2}>
            <text content={ansiToStyledText(diff)} />
          </box>
          <ToolResultBlock content={content} expanded={false} />
        </box>
      );
    }
  }

  return <ToolResultBlock content={content} expanded={expanded} />;
});

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
  outputChars: number,
  tick: number,
  avgTokensPerSecond: number
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
  // Same chars→tokens heuristic as estimateTokenCount, but from the cumulative
  // turn char count (which doesn't collapse when buffers flush mid-turn).
  const estimatedTokens =
    outputChars > 0 ? Math.max(1, Math.round(outputChars / 4)) : 0;
  const currentTokensPerSecond = estimatedTokens / (genElapsedMs / 1000);
  // The average shown mid-turn is the running mean of finalized turns only —
  // the in-progress rate is too jittery to fold in before it lands.

  // `tick` is included so the caller can force a rerender on a timer.
  void tick;

  return {
    ttftMs,
    tokensPerSecond: currentTokensPerSecond,
    avgTokensPerSecond,
  };
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

/** Color a rendered todo line by its status marker ([x] done, [~] active). */
function todoLineColor(line: string): string {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('[x]')) return 'green';
  if (trimmed.startsWith('[~]')) return 'yellow';
  return MUTED;
}

/**
 * Inline transcript rendering of a todowrite call: the checklist, one line per
 * item, colored by status. Tolerates both the optimistic content (bare marker
 * lines) and the committed tool result (which prefixes an "Updated todo list:"
 * header) by rendering only the lines that carry a status marker.
 */
const TodoBlock = React.memo(function TodoBlock({
  content,
}: {
  content: string;
}): React.ReactNode {
  const lines = content
    .split('\n')
    .filter((line) => /^\s*\[[ x~]\]/.test(line));

  if (lines.length === 0) {
    return (
      <text fg={MUTED}>
        {'  ↳ '}
        {firstLine(content)}
      </text>
    );
  }

  return (
    <box
      flexDirection="column"
      marginY={1}
      border={['left']}
      borderStyle="rounded"
      borderColor={MUTED}
      paddingLeft={1}
    >
      <text fg={MUTED} attributes={BOLD}>
        Todos
      </text>
      {lines.map((line, index) => (
        <text key={index} fg={todoLineColor(line)}>
          {line}
        </text>
      ))}
    </box>
  );
});

/**
 * Renders a presented plan (a present_plan tool result) as a titled card with
 * the plan markdown and a hint to the hand-off commands. The CLI has no buttons,
 * so /implement (build it) and /edit-plan (revise first) stand in for them.
 */
const PlanBlock = React.memo(function PlanBlock({
  content,
}: {
  content: string;
}): React.ReactNode {
  return (
    <box
      flexDirection="column"
      marginY={1}
      border={['left']}
      borderStyle="rounded"
      borderColor="cyan"
      paddingLeft={1}
    >
      <text fg="cyan" attributes={BOLD}>
        Plan
      </text>
      <MarkdownView content={content} />
      <text fg={MUTED}>
        /implement to build it · /edit-plan to revise it first
      </text>
    </box>
  );
});

function truncatePreview(preview: string): string {
  const lines = preview.split('\n');
  if (lines.length <= MAX_PREVIEW_LINES) return preview;
  return [
    ...lines.slice(0, MAX_PREVIEW_LINES),
    `… (${lines.length - MAX_PREVIEW_LINES} more lines)`,
  ].join('\n');
}

function contextPct(inputTokens: number, contextWindow: number): number {
  return Math.min(100, Math.round((inputTokens / contextWindow) * 100));
}

/**
 * Which "auto-compact is close" milestone applies for the given distance (in
 * percentage points) below the threshold: 1, 2, or 3 points left map to that
 * milestone, up to {@link AUTO_COMPACT_WARN_MARGIN} maps to 5, and anything
 * farther is no warning. Each milestone is flashed once as pressure rises.
 */
function autoCompactWarnMilestone(pointsLeft: number): number | null {
  if (pointsLeft > AUTO_COMPACT_WARN_MARGIN) return null;
  if (pointsLeft <= 3) return Math.max(1, Math.ceil(pointsLeft));
  return AUTO_COMPACT_WARN_MARGIN;
}

/** ASCII progress bar for the /context-usage readout, e.g. [████░░░░░░░░]. */
function contextBar(pct: number, width = 20): string {
  const filled = Math.round((Math.min(Math.max(pct, 0), 100) / 100) * width);
  return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}]`;
}

/** Context-pressure color, matching the extension's ring: amber above 60%,
 * red above 80%. */
function contextUsageColor(pct: number): string {
  if (pct > 80) return 'red';
  if (pct > 60) return 'yellow';
  return 'white';
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
