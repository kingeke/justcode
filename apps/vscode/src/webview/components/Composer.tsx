import * as React from 'react';

import {
  applyMentionSuggestion,
  applySymbolSuggestion,
  filterMentionSuggestions,
  filterModeSuggestions,
  filterSymbolSuggestions,
  getActiveMentionQuery,
  getActiveSymbolMention,
} from '@core/application/prompt-attachment-service';
import {
  BUILT_IN_MODE_CATEGORY,
  CUSTOM_MODE_CATEGORY,
  modePlaceholder,
  type ChatMode,
} from '@core/domain/chat-mode';
import {
  clampComposerHeight,
  COMPOSER_MIN_ROWS,
} from '@ext/webview/composer-autosize';
import {
  filterSkillCommands,
  getActiveSlashQuery,
} from '@ext/webview/skill-command-completions';
import { stageFiles } from '@ext/webview/attachment-files';
import type {
  WebviewFileAttachment,
  WebviewImage,
  WebviewMode,
  WebviewModel,
  WebviewModelDefaults,
  WebviewReasoningChoice,
  WebviewSkillCommand,
  WebviewStats,
  WebviewTool,
  WebviewUsage,
} from '@ext/shared/protocol';
import { WebviewReasoningDisabled } from '@ext/shared/protocol';
import {
  CogIcon,
  LayersIcon,
  ModeIcon,
  FileIcon,
  PaperclipIcon,
  PlusIcon,
  SendIcon,
  SlidersIcon,
  StopIcon,
  ToolIcon,
} from '@ext/webview/components/Icons';

// The Claude Code provider id (matches `ProviderId.ClaudeCode`). Hardcoded here
// rather than imported from the catalog, which pulls Node-only provider code
// into this browser-targeted webview bundle.
const CLAUDE_CODE_PROVIDER_ID = 'claude-code';

// File reading/staging (images vs text vs rejected binaries) lives in
// attachment-files.ts, shared with the app-level drag-and-drop overlay.

export interface ComposerProps {
  busy: boolean;
  disabled: boolean;
  models: WebviewModel[];
  activeModel: string | undefined;
  activeProviderId: string | undefined;
  usage: WebviewUsage | undefined;
  stats: WebviewStats | undefined;
  autoApprove: boolean;
  expandTools: boolean;
  maxReadLines: number;
  /** Recent context window items sent to the model per request; 0 means "off" (send all). */
  maxHistoryMessages: number;
  /** The user's chosen reasoning effort per model, nested by provider id. */
  reasoningEffortByModel: Record<
    string,
    Record<string, WebviewReasoningChoice | undefined> | undefined
  >;
  onSetReasoningEffort: (
    model: WebviewModel,
    effort: WebviewReasoningChoice
  ) => void;
  onSubmit: (
    content: string,
    images: WebviewImage[],
    files?: WebviewFileAttachment[]
  ) => void;
  onCancel: () => void;
  /** The unsent draft to restore on mount (survives the composer unmounting). */
  initialDraft?: string;
  /** Staged images to restore on mount, paired with {@link initialDraft}. */
  initialImages?: WebviewImage[];
  /** Staged file attachments to restore on mount, like {@link initialImages}. */
  initialFiles?: WebviewFileAttachment[];
  /** Mirror the live draft up so it persists while a full-screen view is open. */
  onDraftChange?: (
    draft: string,
    images: WebviewImage[],
    files: WebviewFileAttachment[]
  ) => void;
  /**
   * Files dropped onto the chat (the app-level drop overlay), to stage as
   * attachments. The composer consumes them and calls
   * {@link onDroppedFilesHandled} so the same drop isn't staged twice.
   */
  droppedFiles?: File[] | null;
  onDroppedFilesHandled?: () => void;
  /** Slash commands from installed skills, for the `/` completions dropdown. */
  skillCommands?: WebviewSkillCommand[];
  /** Workspace files for `@file` completions (fetched lazily, filtered locally). */
  workspaceFiles: string[];
  /** A file's symbols for `@path::method` completions, cached by path. */
  fileSymbols: Record<string, string[]>;
  /** Ask the host for the workspace file list (first time an `@` mention opens). */
  onRequestWorkspaceFiles: () => void;
  /** Ask the host for a file's symbols (first time a `@path::` mention opens). */
  onRequestFileSymbols: (path: string) => void;
  onNewSession: () => void;
  onOpenModelPicker: () => void;
  /** Opens a full-size preview of a staged image (data URL). */
  onOpenImage?: (src: string) => void;
  onToggleAutoApprove: () => void;
  onToggleExpandTools: () => void;
  onSetReadLimit: (lines: number) => void;
  /** Pass 0 to turn trimming off (send the whole conversation). */
  onSetHistoryLimit: (count: number) => void;
  /** When true, thinking blocks start collapsed. */
  thinkingCollapsed: boolean;
  onToggleThinkingCollapsed: () => void;
  /** When true, local providers refetch their model list on every load. */
  localModelAutoRefresh: boolean;
  onToggleLocalModelAutoRefresh: () => void;
  /** When true (default), cached model lists auto-refresh once a day. */
  modelAutoRefresh: boolean;
  onToggleModelAutoRefresh: () => void;
  /** When true, lazy tool loading is on (off = all tools up front). */
  lazyToolLoading: boolean;
  onToggleLazyToolLoading: () => void;
  /** The toggleable tools, grouped by category, for the manage-tools popup. */
  manageableTools: WebviewTool[];
  /** Names of tools currently turned off. */
  disabledTools: string[];
  /** Persist a new full set of disabled tool names. */
  onSetDisabledTools: (names: string[]) => void;
  /** Open `mcp.json` to add or edit MCP servers. */
  onOpenMcpConfig: () => void;
  /** Open Settings focused on the System Prompts tab. */
  onOpenPromptSettings: () => void;
  /** Whether MCP servers are still connecting (shows a spinner on the tools button). */
  mcpLoading: boolean;
  /** Available chat modes (built-in + custom) for the mode picker. */
  modes: WebviewMode[];
  /** The currently active mode id. */
  activeModeId: string;
  /** Per-mode default models, so each row can show its bound model. */
  modelDefaults: WebviewModelDefaults;
  /** Switch the active mode. */
  onSelectMode: (modeId: string) => void;
  /** Delete a custom mode (built-ins can never be deleted). */
  onDeleteMode: (modeId: string) => void;
  /** Create a custom mode with a name and optional system prompt. */
  onCreateMode: (name: string, systemPrompt?: string) => void;
  /** Open the model picker to bind a mode's default model. */
  onSetModeDefaultModel: (modeId: string) => void;
  /** Clear a mode's default model. */
  onClearModeDefaultModel: (modeId: string) => void;
  /** Auto-compact when ctx usage reaches this percent of the window; 0 = off. */
  autoCompactThresholdPercent: number;
  /** Persist a new auto-compact threshold percent (0 = off). */
  onSetAutoCompactThreshold: (percent: number) => void;
  /** True while the host is summarizing the conversation. */
  compacting: boolean;
  /** Summarize the conversation now and continue from the compact summary. */
  onCompact: () => void;
}

/**
 * The Copilot-style composer: one rounded box holding the prompt, an in-box
 * toolbar (new · mode · model · provider · send), and a settings strip beneath
 * it (auto approvals · expand · read limit · usage). Enter submits; Shift+Enter
 * inserts a newline, matching the CLI.
 */
export function Composer(props: ComposerProps): React.JSX.Element {
  const { busy, disabled } = props;
  // Seed from the persisted draft so reopening from the model picker (which
  // unmounts the composer) restores what the user had typed.
  const [value, setValue] = React.useState(props.initialDraft ?? '');
  const [images, setImages] = React.useState<WebviewImage[]>(
    props.initialImages ?? []
  );
  const [files, setFiles] = React.useState<WebviewFileAttachment[]>(
    props.initialFiles ?? []
  );
  // Names of files that couldn't be attached (binary/oversized), shown as a
  // small note under the chips; cleared by the next attach or send.
  const [attachWarning, setAttachWarning] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Stage a batch of picked/dropped/pasted files: images become image chips,
  // text files become attachment chips, rejects surface as a note.
  const attachFiles = React.useCallback(async (raw: File[]): Promise<void> => {
    if (raw.length === 0) return;
    const staged = await stageFiles(raw);
    if (staged.images.length > 0) {
      setImages((prev) => [...prev, ...staged.images]);
    }
    if (staged.files.length > 0) {
      setFiles((prev) => {
        // Re-attaching the same file name replaces the stale copy.
        const names = new Set(staged.files.map((f) => f.name));
        return [...prev.filter((f) => !names.has(f.name)), ...staged.files];
      });
    }
    setAttachWarning(
      staged.rejected.length > 0
        ? `Couldn't attach: ${staged.rejected.join(', ')}`
        : null
    );
  }, []);

  // Files dropped on the app-level overlay land here to be staged.
  const { droppedFiles, onDroppedFilesHandled } = props;
  React.useEffect(() => {
    if (!droppedFiles || droppedFiles.length === 0) return;
    void attachFiles(droppedFiles);
    onDroppedFilesHandled?.();
  }, [droppedFiles, onDroppedFilesHandled, attachFiles]);

  // Grow the textarea from MIN_ROWS up to MAX_ROWS as its content changes,
  // measuring the wrapped content height so long/wrapped lines count too.
  React.useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${clampComposerHeight(el.scrollHeight)}px`;
  }, [value, images]);

  // Mirror the draft up on every change so it outlives this component when a
  // full-screen view (model picker, sessions) takes over and unmounts it.
  const { onDraftChange } = props;
  React.useEffect(() => {
    onDraftChange?.(value, images, files);
  }, [value, images, files, onDraftChange]);
  const [showSettings, setShowSettings] = React.useState(false);
  const [showReasoning, setShowReasoning] = React.useState(false);
  const [showTools, setShowTools] = React.useState(false);
  // Compaction locks the toolbar; also fold shut any popup already open so its
  // inner controls (mode switch, settings edits, ...) can't be used mid-run.
  const { compacting } = props;
  React.useEffect(() => {
    if (!compacting) return;
    setShowSettings(false);
    setShowReasoning(false);
    setShowTools(false);
    setShowModes(false);
    setShowContextInfo(false);
  }, [compacting]);
  // Category headings folded shut in the manage-tools popup (tool rows hidden).
  const [collapsedCategories, setCollapsedCategories] = React.useState<
    Set<string>
  >(new Set());
  const [showModes, setShowModes] = React.useState(false);
  const [showContextInfo, setShowContextInfo] = React.useState(false);
  const contextInfoRef = React.useRef<HTMLDivElement>(null);
  // When set, the mode popup shows the "create custom mode" form instead.
  const [creatingMode, setCreatingMode] = React.useState(false);
  const [modeNameDraft, setModeNameDraft] = React.useState('');
  const [modePromptDraft, setModePromptDraft] = React.useState('');
  const reasoningRef = React.useRef<HTMLDivElement>(null);
  const toolsRef = React.useRef<HTMLDivElement>(null);
  const modesRef = React.useRef<HTMLDivElement>(null);
  const [readLimitDraft, setReadLimitDraft] = React.useState('');
  const [editingReadLimit, setEditingReadLimit] = React.useState(false);
  const [historyLimitDraft, setHistoryLimitDraft] = React.useState('');
  const [editingHistoryLimit, setEditingHistoryLimit] = React.useState(false);
  const [autoCompactDraft, setAutoCompactDraft] = React.useState('');
  const [editingAutoCompact, setEditingAutoCompact] = React.useState(false);
  const settingsRef = React.useRef<HTMLDivElement>(null);
  // Commits any in-progress settings edits before the popup closes. Closing
  // unmounts the inputs without firing their onBlur, so the drafts would be
  // lost. Routed through a ref because the outside-click listener registers
  // once per popup open and would otherwise call a stale closure.
  const commitPendingSettingsEditsRef = React.useRef<() => void>(() => {});

  // Close the settings popup when clicking outside it.
  React.useEffect(() => {
    if (!showSettings) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (
        settingsRef.current &&
        !settingsRef.current.contains(e.target as Node)
      ) {
        commitPendingSettingsEditsRef.current();
        setShowSettings(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [showSettings]);

  // Close the context-info popup when clicking outside it.
  React.useEffect(() => {
    if (!showContextInfo) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (
        contextInfoRef.current &&
        !contextInfoRef.current.contains(e.target as Node)
      ) {
        setShowContextInfo(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [showContextInfo]);

  // Close the reasoning popup when clicking outside it.
  React.useEffect(() => {
    if (!showReasoning) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (
        reasoningRef.current &&
        !reasoningRef.current.contains(e.target as Node)
      ) {
        setShowReasoning(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [showReasoning]);

  // Close the manage-tools popup when clicking outside it.
  React.useEffect(() => {
    if (!showTools) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) {
        setShowTools(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [showTools]);

  // Close the mode popup when clicking outside it.
  React.useEffect(() => {
    if (!showModes) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (modesRef.current && !modesRef.current.contains(e.target as Node)) {
        setShowModes(false);
        setCreatingMode(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [showModes]);

  // Group the tools by category, preserving first-seen order, for the popup.
  const toolCategories = React.useMemo<
    { category: string; tools: WebviewTool[] }[]
  >(() => {
    const order: string[] = [];
    const byCategory = new Map<string, WebviewTool[]>();
    for (const tool of props.manageableTools) {
      if (!byCategory.has(tool.category)) {
        byCategory.set(tool.category, []);
        order.push(tool.category);
      }
      byCategory.get(tool.category)?.push(tool);
    }
    return order.map((category) => ({
      category,
      tools: byCategory.get(category) ?? [],
    }));
  }, [props.manageableTools]);

  // Start every category collapsed so the popup stays compact; a category is
  // only auto-collapsed the first time it appears, so the user's own expand/
  // collapse choices survive re-renders (and newly added MCP servers default
  // collapsed too).
  const seenCategoriesRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    const fresh = toolCategories
      .map((entry) => entry.category)
      .filter((category) => !seenCategoriesRef.current.has(category));
    if (fresh.length === 0) return;
    for (const category of fresh) seenCategoriesRef.current.add(category);
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      for (const category of fresh) next.add(category);
      return next;
    });
  }, [toolCategories]);

  const disabledSet = React.useMemo(
    () => new Set(props.disabledTools),
    [props.disabledTools]
  );

  const builtInModes = React.useMemo(
    () => props.modes.filter((m) => !m.custom),
    [props.modes]
  );
  const customModes = React.useMemo(
    () => props.modes.filter((m) => m.custom),
    [props.modes]
  );
  const activeMode = props.modes.find((m) => m.id === props.activeModeId);
  const activeModeName = activeMode?.name ?? 'Build';

  // The display label for a mode's bound default model, or null when none is
  // set. Resolves the stored provider+model reference against the model list so
  // it shows the friendly name; falls back to the raw id if the model is gone.
  const modeDefaultLabel = (modeId: string): string | null => {
    const ref = props.modelDefaults.byMode[modeId];
    if (!ref) return null;
    const model = props.models.find(
      (m) => m.id === ref.modelId && m.providerId === ref.providerId
    );
    return model?.displayName ?? ref.modelId;
  };

  const submitCreateMode = (): void => {
    const name = modeNameDraft.trim();
    if (!name) return;
    const prompt = modePromptDraft.trim();
    props.onCreateMode(name, prompt.length > 0 ? prompt : undefined);
    setModeNameDraft('');
    setModePromptDraft('');
    setCreatingMode(false);
    setShowModes(false);
  };

  // Apply a change to the disabled set and push the full new list to the host.
  const applyDisabled = (next: Set<string>): void => {
    props.onSetDisabledTools(
      props.manageableTools
        .filter((tool) => next.has(tool.name))
        .map((tool) => tool.name)
    );
  };

  const toggleTool = (name: string): void => {
    const next = new Set(disabledSet);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    applyDisabled(next);
  };

  // A category header turns its whole group on, unless every tool is already on
  // — then it turns them all off, so a second click undoes the first.
  const toggleCategory = (tools: WebviewTool[]): void => {
    const allOn = tools.every((tool) => !disabledSet.has(tool.name));
    const next = new Set(disabledSet);
    for (const tool of tools) {
      if (allOn) next.add(tool.name);
      else next.delete(tool.name);
    }
    applyDisabled(next);
  };

  const toggleCollapse = (category: string): void => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  // The active model and its reasoning capability, used to offer a thinking-
  // level picker only for models the provider reports as reasoning-capable.
  const activeModelObj =
    props.models.find(
      (m) =>
        m.id === props.activeModel && m.providerId === props.activeProviderId
    ) ?? props.models.find((m) => m.id === props.activeModel);
  // Context usage shown as a ring gauge before the tools icon: the most recent
  // request's input tokens (the status bar's "ctx" readout — what the model
  // currently sees) against the model's window. Only models that report a
  // context window get it.
  const contextWindow = activeModelObj?.contextWindow;
  const contextUsed = props.usage?.lastInputTokens ?? 0;
  const contextInfo =
    contextWindow != null && contextWindow > 0
      ? {
          used: contextUsed,
          window: contextWindow,
          pct: Math.min(100, Math.round((contextUsed / contextWindow) * 100)),
        }
      : undefined;
  // Within 5 points below the auto-compact threshold the ring pulses as an
  // ambient heads-up that the next turn is likely to trigger a compaction.
  const nearAutoCompact =
    contextInfo !== undefined &&
    props.autoCompactThresholdPercent > 0 &&
    contextInfo.pct < props.autoCompactThresholdPercent &&
    contextInfo.pct >= props.autoCompactThresholdPercent - 5;

  const reasoning = activeModelObj?.reasoning;
  const reasoningLevels = reasoning?.effortLevels ?? [];
  const reasoningSupported = reasoningLevels.length > 0;
  const storedEffort = activeModelObj
    ? props.reasoningEffortByModel[activeModelObj.providerId]?.[
        activeModelObj.id
      ]
    : undefined;
  const defaultEffort = reasoning?.defaultEffort ?? reasoningLevels[0];
  // What's in effect now: the stored choice, or the model default when unset. A
  // mandatory model ignores a stale "off" (it always reasons), matching the host.
  const usableStored =
    reasoning?.mandatory && storedEffort === WebviewReasoningDisabled.Off
      ? undefined
      : storedEffort;
  const effectiveEffort: WebviewReasoningChoice =
    usableStored ?? defaultEffort ?? WebviewReasoningDisabled.Off;
  // Mandatory models always reason, so "off" isn't offered; optional ones lead
  // with it (mirrors the CLI's reasoning picker).
  const reasoningChoices: WebviewReasoningChoice[] = reasoning?.mandatory
    ? [...reasoningLevels]
    : [WebviewReasoningDisabled.Off, ...reasoningLevels];

  const submit = (): void => {
    const trimmed = value.trim();
    // An attachment-only message is valid (just a pasted screenshot or a
    // dropped file), so allow a send with no prose when something is staged.
    // While a turn is busy this still fires — the parent queues it.
    if ((!trimmed && images.length === 0 && files.length === 0) || disabled) {
      return;
    }
    props.onSubmit(trimmed, images, files);
    setValue('');
    setImages([]);
    setFiles([]);
    setAttachWarning(null);
  };

  // --- /command completions (skill commands) --------------------------------
  // A draft that is a single leading `/token` completes against the installed
  // skills' commands. Selecting one inserts `/name ` so the user can type the
  // arguments; execution happens host-side when the message is submitted.
  const [slashIndex, setSlashIndex] = React.useState(0);
  const [slashDismissed, setSlashDismissed] = React.useState(false);
  const slashQuery = React.useMemo(() => getActiveSlashQuery(value), [value]);
  // Built-in host commands that live in the same `/` menu as skill commands.
  // `/usage` reports subscription plan limits, which only Claude Code surfaces,
  // so it's offered only when that provider is active (mirrors the CLI palette).
  const hostSlashCommands = React.useMemo<WebviewSkillCommand[]>(
    () =>
      props.activeProviderId === CLAUDE_CODE_PROVIDER_ID
        ? [
            {
              name: 'usage',
              skillName: '',
              description: 'Show plan usage and limits (Claude Code)',
            },
          ]
        : [],
    [props.activeProviderId]
  );
  const slashSuggestions = React.useMemo(
    () =>
      slashQuery !== undefined
        ? filterSkillCommands(
            [...hostSlashCommands, ...(props.skillCommands ?? [])],
            slashQuery
          )
        : [],
    [slashQuery, props.skillCommands, hostSlashCommands]
  );
  const slashOpen =
    slashQuery !== undefined && !slashDismissed && slashSuggestions.length > 0;
  const activeSlashIndex = Math.min(
    slashIndex,
    Math.max(0, slashSuggestions.length - 1)
  );
  React.useEffect(() => {
    setSlashIndex(0);
  }, [slashQuery]);

  const applySlashCommand = (name: string): void => {
    setValue(`/${name} `);
    setSlashDismissed(false);
    textareaRef.current?.focus();
  };

  // --- @file / @path::method completions ----------------------------------
  // A trailing `@path::query` switches completion from files to that file's
  // symbols; otherwise a trailing `@query` completes file paths. Both are
  // derived from the prompt text each render and filtered locally against the
  // host-provided lists, mirroring the CLI.
  const [mentionIndex, setMentionIndex] = React.useState(0);
  const [mentionDismissed, setMentionDismissed] = React.useState(false);

  const symbolMention = React.useMemo(
    () => getActiveSymbolMention(value),
    [value]
  );
  const fileQuery = React.useMemo(
    () => (symbolMention ? undefined : getActiveMentionQuery(value)),
    [value, symbolMention]
  );
  // Chat modes matching the `@` query, offered ahead of files so `@plan`-style
  // mentions can switch modes. Applying one inserts the mode's id.
  const modeMentionSuggestions = React.useMemo(
    () =>
      symbolMention
        ? []
        : (filterModeSuggestions(
            props.modes as unknown as ChatMode[],
            fileQuery
          ) as unknown as WebviewMode[]),
    [symbolMention, fileQuery, props.modes]
  );
  const mentionSuggestions = React.useMemo<string[]>(() => {
    if (symbolMention) {
      return filterSymbolSuggestions(
        props.fileSymbols[symbolMention.path] ?? [],
        symbolMention.query
      );
    }
    if (fileQuery !== undefined) {
      const modeIds = new Set(modeMentionSuggestions.map((mode) => mode.id));
      return [
        ...modeMentionSuggestions.map((mode) => mode.id),
        ...filterMentionSuggestions(props.workspaceFiles, fileQuery).filter(
          (path) => !modeIds.has(path)
        ),
      ];
    }
    return [];
  }, [
    symbolMention,
    fileQuery,
    props.fileSymbols,
    props.workspaceFiles,
    modeMentionSuggestions,
  ]);

  const mentionActive = symbolMention !== undefined || fileQuery !== undefined;
  const mentionOpen =
    mentionActive && !mentionDismissed && mentionSuggestions.length > 0;
  const activeMentionIndex = Math.min(
    mentionIndex,
    Math.max(0, mentionSuggestions.length - 1)
  );

  // Refetch each time a mention *opens* (file list) or its path changes (symbol
  // list), rather than once per session, so files/methods created since the last
  // mention show up. We don't refetch on every keystroke within one open mention
  // — the loaded list is filtered locally — to avoid re-walking the workspace per
  // character; reopening `@` (or switching the `::` file) picks up new entries.
  const fileMentionWasActiveRef = React.useRef(false);
  const lastSymbolPathRef = React.useRef<string | null>(null);
  const { onRequestWorkspaceFiles, onRequestFileSymbols } = props;
  React.useEffect(() => {
    const active = fileQuery !== undefined;
    if (active && !fileMentionWasActiveRef.current) {
      onRequestWorkspaceFiles();
    }
    fileMentionWasActiveRef.current = active;
  }, [fileQuery, onRequestWorkspaceFiles]);
  React.useEffect(() => {
    const path = symbolMention?.path ?? null;
    if (path && path !== lastSymbolPathRef.current) {
      onRequestFileSymbols(path);
    }
    lastSymbolPathRef.current = path;
  }, [symbolMention, onRequestFileSymbols]);

  // Reset the highlighted row whenever the active query changes.
  const mentionKey = symbolMention
    ? `symbol:${symbolMention.path}:${symbolMention.query}`
    : fileQuery !== undefined
      ? `file:${fileQuery}`
      : '';
  React.useEffect(() => {
    setMentionIndex(0);
  }, [mentionKey]);

  const changeValue = (next: string): void => {
    setValue(next);
    // Any edit re-opens a dropdown the user had dismissed with Esc.
    setMentionDismissed(false);
    setSlashDismissed(false);
  };

  const applyMention = (suggestion: string): void => {
    const next = symbolMention
      ? applySymbolSuggestion(value, suggestion)
      : applyMentionSuggestion(value, suggestion);
    changeValue(next);
    textareaRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // While the `/` command dropdown is open it owns the arrow keys, Tab
    // (apply), and Esc (dismiss). Enter applies the highlighted command —
    // unless the draft already names it exactly, in which case it submits, so
    // a fully-typed `/scan` doesn't need a second Enter.
    if (slashOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSlashIndex((i) => (i + 1) % slashSuggestions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashIndex(
          (i) => (i - 1 + slashSuggestions.length) % slashSuggestions.length
        );
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const choice = slashSuggestions[activeSlashIndex];
        if (!choice) return;
        if (event.key === 'Enter' && choice.name === slashQuery) {
          submit();
        } else {
          applySlashCommand(choice.name);
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setSlashDismissed(true);
        return;
      }
    }

    // While the completions dropdown is open it owns the arrow keys, Enter/Tab
    // (apply), and Esc (dismiss) — so they don't submit or cancel the turn.
    if (mentionOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionSuggestions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMentionIndex(
          (i) => (i - 1 + mentionSuggestions.length) % mentionSuggestions.length
        );
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const choice = mentionSuggestions[activeMentionIndex];
        if (choice) applyMention(choice);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMentionDismissed(true);
        return;
      }
    }

    // Shift+Tab cycles the chat mode (Build → Ask → Plan → custom → …), matching
    // the CLI. Handled here so it works while typing in the composer.
    if (event.key === 'Tab' && event.shiftKey && props.modes.length > 1) {
      event.preventDefault();
      const index = props.modes.findIndex((m) => m.id === props.activeModeId);
      const next = props.modes[(index + 1) % props.modes.length];
      if (next) props.onSelectMode(next.id);
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
    // Esc interrupts the in-flight turn, mirroring the Stop button (and the CLI).
    if (event.key === 'Escape' && busy) {
      event.preventDefault();
      props.onCancel();
    }
  };

  // Pasting image bytes into the prompt stages them as chips above the textarea
  // and sends them as proper image blocks rather than inserting anything inline.
  const onPaste = async (
    event: React.ClipboardEvent<HTMLTextAreaElement>
  ): Promise<void> => {
    const items = event.clipboardData.items;
    const pasted: File[] = [];
    // DataTransferItemList is array-like but not reliably iterable, so index it.
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item && item.kind === 'file') {
        const file = item.getAsFile();
        if (file) pasted.push(file);
      }
    }
    if (pasted.length === 0) return;
    // Keep the textarea from also inserting a file path / nothing for the paste.
    event.preventDefault();
    await attachFiles(pasted);
  };

  const removeImage = (id: string): void => {
    setImages((prev) => prev.filter((image) => image.id !== id));
  };

  const removeFile = (id: string): void => {
    setFiles((prev) => prev.filter((file) => file.id !== id));
  };

  // The paperclip button routes through a hidden file input; any file type is
  // accepted — staging decides image vs text vs rejected.
  const onFilesPicked = async (
    event: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const picked = Array.from(event.target.files ?? []);
    // Reset so picking the same file again re-fires the change event.
    event.target.value = '';
    await attachFiles(picked);
  };

  const imageLabel = (index: number): string =>
    index === 0 ? 'Pasted Image' : `Pasted Image ${index + 1}`;

  const commitReadLimit = (): void => {
    const parsed = parseInt(readLimitDraft, 10);
    if (!isNaN(parsed) && parsed > 0) {
      props.onSetReadLimit(parsed);
    }
    setEditingReadLimit(false);
  };

  const onReadLimitKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ): void => {
    if (event.key === 'Enter') commitReadLimit();
    if (event.key === 'Escape') setEditingReadLimit(false);
  };

  const commitHistoryLimit = (): void => {
    // Blank or 0 turns trimming off (send the whole conversation); any positive
    // value caps how many recent messages are forwarded.
    const trimmed = historyLimitDraft.trim();
    if (trimmed === '') {
      props.onSetHistoryLimit(0);
    } else {
      const parsed = parseInt(trimmed, 10);
      if (!isNaN(parsed) && parsed >= 0) {
        props.onSetHistoryLimit(parsed);
      }
    }
    setEditingHistoryLimit(false);
  };

  const onHistoryLimitKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ): void => {
    if (event.key === 'Enter') commitHistoryLimit();
    if (event.key === 'Escape') setEditingHistoryLimit(false);
  };

  const commitAutoCompact = (): void => {
    // Blank or 0 turns auto-compact off; 1-100 sets the trigger percent.
    const trimmed = autoCompactDraft.trim();
    if (trimmed === '') {
      props.onSetAutoCompactThreshold(0);
    } else {
      const parsed = parseInt(trimmed, 10);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
        props.onSetAutoCompactThreshold(parsed);
      }
    }
    setEditingAutoCompact(false);
  };

  const onAutoCompactKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ): void => {
    if (event.key === 'Enter') commitAutoCompact();
    if (event.key === 'Escape') setEditingAutoCompact(false);
  };

  commitPendingSettingsEditsRef.current = (): void => {
    if (editingReadLimit) commitReadLimit();
    if (editingHistoryLimit) commitHistoryLimit();
    if (editingAutoCompact) commitAutoCompact();
  };

  return (
    <div className="composer-area">
      <div
        className={`composer ${disabled ? 'composer-disabled' : ''} ${
          busy ? 'composer-busy' : ''
        }`}
      >
        {files.length > 0 || images.length > 0 ? (
          <div className="composer-attachments">
            {files.map((file) => (
              <div key={file.id} className="composer-attachment composer-file">
                <button
                  type="button"
                  className="composer-attachment-remove"
                  title="Remove file"
                  onClick={() => removeFile(file.id)}
                >
                  ×
                </button>
                <span className="composer-file-icon" aria-hidden="true">
                  <FileIcon size={14} />
                </span>
                <span className="composer-attachment-label" title={file.name}>
                  {file.name}
                </span>
              </div>
            ))}
            {images.map((image, index) => {
              const src = `data:${image.mediaType};base64,${image.data}`;
              return (
                <div key={image.id} className="composer-attachment">
                  <button
                    type="button"
                    className="composer-attachment-remove"
                    title="Remove image"
                    onClick={() => removeImage(image.id)}
                  >
                    ×
                  </button>
                  <button
                    type="button"
                    className="composer-attachment-thumb-btn"
                    title="Click to preview"
                    onClick={() => props.onOpenImage?.(src)}
                  >
                    <img
                      className="composer-attachment-thumb"
                      src={src}
                      alt={imageLabel(index)}
                    />
                  </button>
                  <span className="composer-attachment-label">
                    {imageLabel(index)}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
        {attachWarning ? (
          <div className="composer-attach-warning">{attachWarning}</div>
        ) : null}
        {slashOpen ? (
          <ul className="composer-mentions" role="listbox">
            {slashSuggestions.map((command, index) => (
              <li
                key={command.name}
                role="option"
                aria-selected={index === activeSlashIndex}
                className={`composer-mention ${
                  index === activeSlashIndex ? 'composer-mention-active' : ''
                }`}
                // onMouseDown (not onClick) so the textarea keeps focus and the
                // blur doesn't fire before the selection is applied.
                onMouseDown={(event) => {
                  event.preventDefault();
                  applySlashCommand(command.name);
                }}
                onMouseEnter={() => setSlashIndex(index)}
              >
                <span className="composer-command-name">/{command.name}</span>
                {command.argumentHint ? (
                  <span className="composer-command-hint">
                    {command.argumentHint}
                  </span>
                ) : null}
                <span className="composer-command-desc">
                  {command.description ?? `${command.skillName} skill`}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {mentionOpen ? (
          <ul className="composer-mentions" role="listbox">
            {/* Every symbol comes from the same file, so name the location once
                as a header instead of repeating the path on every method. */}
            {symbolMention ? (
              <li className="composer-mention-heading" aria-hidden="true">
                Methods in <span>{symbolMention.path}</span>
              </li>
            ) : null}
            {mentionSuggestions.map((suggestion, index) => {
              // Mode entries carry a "<name> mode" hint so they read apart
              // from file paths; picking one switches to that mode on submit.
              const mode = modeMentionSuggestions.find(
                (candidate) => candidate.id === suggestion
              );
              return (
                <li
                  key={suggestion}
                  role="option"
                  aria-selected={index === activeMentionIndex}
                  className={`composer-mention ${
                    index === activeMentionIndex
                      ? 'composer-mention-active'
                      : ''
                  }`}
                  // onMouseDown (not onClick) so the textarea keeps focus and the
                  // blur doesn't fire before the selection is applied.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    applyMention(suggestion);
                  }}
                  onMouseEnter={() => setMentionIndex(index)}
                >
                  {symbolMention ? (
                    <span className="composer-mention-symbol">
                      {suggestion}
                    </span>
                  ) : (
                    suggestion
                  )}
                  {mode ? (
                    <span className="composer-command-desc">
                      {mode.name} mode
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        <textarea
          ref={textareaRef}
          className="composer-input"
          value={value}
          rows={COMPOSER_MIN_ROWS}
          disabled={disabled}
          placeholder={
            disabled
              ? 'Configure a provider to start chatting…'
              : busy
                ? 'Queue a follow-up — sends when this turn finishes…'
                : modePlaceholder(props.activeModeId)
          }
          onChange={(event) => changeValue(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />

        <div className="composer-toolbar">
          <div className="toolbar-left">
            <button
              type="button"
              className="icon-btn"
              title="New session"
              disabled={props.compacting}
              onClick={props.onNewSession}
            >
              <PlusIcon />
            </button>

            <button
              type="button"
              className="icon-btn"
              title="Attach a file as context — or drop files onto the chat (hold Shift while dropping from outside VS Code)"
              disabled={props.compacting}
              onClick={() => fileInputRef.current?.click()}
            >
              <PaperclipIcon />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="composer-file-input"
              onChange={onFilesPicked}
            />

            <span className="toolbar-divider" />

            <div className="settings-popup-anchor" ref={modesRef}>
              {showModes ? (
                <div className="settings-popup modes-popup">
                  {creatingMode ? (
                    <div className="settings-popup-section modes-form">
                      <div className="settings-popup-heading">
                        <span>New mode</span>
                      </div>
                      <input
                        type="text"
                        className="modes-input"
                        placeholder="Mode name"
                        value={modeNameDraft}
                        autoFocus
                        onChange={(e) => setModeNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            submitCreateMode();
                          }
                        }}
                      />
                      <textarea
                        className="modes-textarea"
                        placeholder="System prompt (optional)"
                        rows={4}
                        value={modePromptDraft}
                        onChange={(e) => setModePromptDraft(e.target.value)}
                      />
                      <div className="modes-form-hint">
                        AGENTS.md and the workspace path are always included.
                      </div>
                    </div>
                  ) : (
                    <div className="settings-popup-section modes-scroll">
                      <div className="modes-group">
                        <div className="modes-category-label">
                          {BUILT_IN_MODE_CATEGORY}
                        </div>
                        {builtInModes.map((mode) => {
                          const isCurrent = mode.id === props.activeModeId;
                          const defaultLabel = modeDefaultLabel(mode.id);
                          return (
                            <div key={mode.id} className="modes-item-row">
                              <button
                                type="button"
                                className="modes-item"
                                onClick={() => {
                                  props.onSelectMode(mode.id);
                                  setShowModes(false);
                                }}
                              >
                                <span
                                  className={`tools-check ${isCurrent ? 'tools-check-on' : ''}`}
                                >
                                  {isCurrent ? '✓' : ''}
                                </span>
                                <span className="modes-item-icon">
                                  <ModeIcon icon={mode.icon} />
                                </span>
                                <span className="modes-item-label">
                                  {mode.name}
                                </span>
                              </button>
                              <ModeDefaultModelControl
                                label={defaultLabel}
                                onSet={() =>
                                  props.onSetModeDefaultModel(mode.id)
                                }
                                onClear={() =>
                                  props.onClearModeDefaultModel(mode.id)
                                }
                              />
                            </div>
                          );
                        })}
                      </div>
                      {customModes.length > 0 ? (
                        <div className="modes-group">
                          <div className="modes-category-label">
                            {CUSTOM_MODE_CATEGORY}
                          </div>
                          {customModes.map((mode) => {
                            const isCurrent = mode.id === props.activeModeId;
                            return (
                              <div key={mode.id} className="modes-item-row">
                                <button
                                  type="button"
                                  className="modes-item"
                                  onClick={() => {
                                    props.onSelectMode(mode.id);
                                    setShowModes(false);
                                  }}
                                >
                                  <span
                                    className={`tools-check ${isCurrent ? 'tools-check-on' : ''}`}
                                  >
                                    {isCurrent ? '✓' : ''}
                                  </span>
                                  <span className="modes-item-icon">
                                    <ModeIcon icon={mode.icon} />
                                  </span>
                                  <span className="modes-item-label">
                                    {mode.name}
                                  </span>
                                </button>
                                <ModeDefaultModelControl
                                  label={modeDefaultLabel(mode.id)}
                                  onSet={() =>
                                    props.onSetModeDefaultModel(mode.id)
                                  }
                                  onClear={() =>
                                    props.onClearModeDefaultModel(mode.id)
                                  }
                                />
                                <button
                                  type="button"
                                  className="modes-item-delete"
                                  title={`Delete ${mode.name}`}
                                  aria-label={`Delete ${mode.name}`}
                                  onClick={() => props.onDeleteMode(mode.id)}
                                >
                                  ✕
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  )}
                  <div className="settings-popup-section tools-mcp-footer">
                    {creatingMode ? (
                      <div className="modes-form-actions">
                        <button
                          type="button"
                          className="tools-mcp-link"
                          onClick={() => {
                            setCreatingMode(false);
                            setModeNameDraft('');
                            setModePromptDraft('');
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="tools-mcp-link modes-create-confirm"
                          disabled={modeNameDraft.trim().length === 0}
                          onClick={submitCreateMode}
                        >
                          Create
                        </button>
                      </div>
                    ) : (
                      <div className="modes-footer-row">
                        <button
                          type="button"
                          className="tools-mcp-link"
                          onClick={() => setCreatingMode(true)}
                          title="Create a custom mode"
                        >
                          + Create mode
                        </button>
                        <button
                          type="button"
                          className="icon-btn modes-settings-btn"
                          title="Edit system prompts in Settings"
                          aria-label="Edit system prompts in Settings"
                          onClick={() => {
                            setShowModes(false);
                            props.onOpenPromptSettings();
                          }}
                        >
                          <CogIcon size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
              <button
                type="button"
                className={`mode-btn ${showModes ? 'mode-btn-active' : ''}`}
                title="Change mode"
                disabled={props.compacting}
                onClick={() => {
                  setShowModes((s) => !s);
                  setCreatingMode(false);
                }}
              >
                {activeMode ? (
                  <span className="mode-btn-icon">
                    <ModeIcon icon={activeMode.icon} />
                  </span>
                ) : null}
                {activeModeName}
              </button>
            </div>

            {(() => {
              const m =
                props.models.find(
                  (m) =>
                    m.id === props.activeModel &&
                    m.providerId === props.activeProviderId
                ) ?? props.models.find((m) => m.id === props.activeModel);
              const label = m
                ? `${m.providerName} · ${m.displayName}`
                : (props.activeModel ?? 'No model');
              return (
                <button
                  type="button"
                  className="model-btn"
                  // The label truncates with an ellipsis, so surface the full
                  // model name on hover.
                  title={m ? label : 'Change model'}
                  disabled={props.models.length === 0 || props.compacting}
                  onClick={props.onOpenModelPicker}
                >
                  {label}
                </button>
              );
            })()}

            {reasoningSupported && activeModelObj ? (
              <div className="reasoning-popup-anchor" ref={reasoningRef}>
                <button
                  type="button"
                  className={`reasoning-btn ${showReasoning ? 'reasoning-btn-active' : ''}`}
                  title="Thinking level"
                  disabled={props.compacting}
                  onClick={() => setShowReasoning((s) => !s)}
                >
                  {effectiveEffort}
                </button>
                {showReasoning ? (
                  <div className="reasoning-popup">
                    <div className="reasoning-popup-title">Thinking level</div>
                    {reasoningChoices.map((choice) => {
                      const isCurrent = choice === effectiveEffort;
                      const isDefault =
                        choice !== WebviewReasoningDisabled.Off &&
                        choice === defaultEffort;
                      return (
                        <button
                          key={choice}
                          type="button"
                          className={`reasoning-choice-btn ${isCurrent ? 'reasoning-choice-active' : ''}`}
                          onClick={() => {
                            props.onSetReasoningEffort(activeModelObj, choice);
                            setShowReasoning(false);
                          }}
                        >
                          <span className="reasoning-choice-label">
                            {choice === WebviewReasoningDisabled.Off
                              ? 'Off'
                              : choice}
                            {isDefault ? (
                              <span className="reasoning-choice-default">
                                {' '}
                                (default)
                              </span>
                            ) : null}
                          </span>
                          {isCurrent ? (
                            <span className="reasoning-choice-check">✓</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="toolbar-right">
            <div className="settings-popup-anchor" ref={contextInfoRef}>
              {showContextInfo ? (
                <div className="settings-popup context-popup">
                  {contextInfo ? (
                    <div className="settings-popup-section">
                      <div className="settings-popup-heading">Session Info</div>
                      <div className="context-popup-title">Context Window</div>
                      <div className="context-popup-row">
                        <span>
                          {contextInfo.used.toLocaleString()} /{' '}
                          {contextInfo.window.toLocaleString()} tokens
                        </span>
                        <span className="context-popup-pct">
                          {contextInfo.pct}%
                        </span>
                      </div>
                      <div className="context-popup-bar">
                        <div
                          className={`context-popup-bar-fill ${contextPressureClass(contextInfo.pct)}`}
                          style={{ width: `${contextInfo.pct}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                  <div className="settings-popup-section">
                    {!contextInfo ? (
                      <div className="context-popup-row context-popup-row-stack">
                        <span className="settings-popup-label">
                          Context Window
                        </span>
                        <span className="context-popup-note">
                          This model does not report a context window.
                        </span>
                      </div>
                    ) : null}
                    <div className="context-popup-row">
                      <span className="settings-popup-label">
                        Total Input Tokens
                      </span>
                      <span>
                        {(props.usage?.inputTokens ?? 0).toLocaleString()}
                      </span>
                    </div>
                    <div className="context-popup-row">
                      <span className="settings-popup-label">
                        Total Cached Tokens
                      </span>
                      <span>
                        {(props.usage?.cachedTokens ?? 0).toLocaleString()}
                      </span>
                    </div>
                    <div className="context-popup-row">
                      <span className="settings-popup-label">
                        Total Output Tokens
                      </span>
                      <span>
                        {(props.usage?.outputTokens ?? 0).toLocaleString()}
                      </span>
                    </div>
                    {props.usage?.cost !== undefined ? (
                      <div className="context-popup-row">
                        <span className="settings-popup-label">
                          Total Session Cost
                        </span>
                        <span>${props.usage.cost.toFixed(4)}</span>
                      </div>
                    ) : null}
                  </div>
                  <div className="settings-popup-section">
                    <button
                      type="button"
                      className="context-compact-btn"
                      disabled={busy || props.compacting}
                      title="Summarize the conversation and continue from the summary, freeing up context"
                      onClick={() => {
                        setShowContextInfo(false);
                        props.onCompact();
                      }}
                    >
                      {props.compacting
                        ? 'Compacting…'
                        : 'Compact conversation'}
                    </button>
                  </div>
                </div>
              ) : null}
              <button
                type="button"
                className={`icon-btn ${showContextInfo ? 'icon-btn-active' : ''} ${contextInfo ? contextPressureClass(contextInfo.pct) : ''} ${nearAutoCompact ? 'context-ring-pulse' : ''}`}
                title={
                  contextInfo
                    ? nearAutoCompact
                      ? `Context window ${contextInfo.pct}% full — auto-compact triggers at >=${props.autoCompactThresholdPercent}%`
                      : `Context window ${contextInfo.pct}% full — ${fmtTokenCount(contextInfo.used)} / ${fmtTokenCount(contextInfo.window)} tokens`
                    : 'Session info and conversation compaction'
                }
                disabled={props.compacting}
                onClick={() => setShowContextInfo((s) => !s)}
              >
                {contextInfo ? (
                  <ContextRing pct={contextInfo.pct} />
                ) : (
                  <LayersIcon size={14} />
                )}
              </button>
            </div>
            <div className="settings-popup-anchor" ref={toolsRef}>
              {showTools ? (
                <div className="settings-popup tools-popup">
                  <div className="settings-popup-section tools-scroll">
                    <div className="settings-popup-heading tools-heading">
                      <span>Tools</span>
                      {props.mcpLoading ? (
                        <span className="tools-loading">
                          <span
                            className="composer-spinner"
                            role="status"
                            aria-label="Loading MCP servers"
                          />
                          Loading MCP servers…
                        </span>
                      ) : null}
                    </div>
                    {props.manageableTools.length === 0 ? (
                      <div className="settings-popup-row">
                        <span className="settings-popup-label">
                          No tools available
                        </span>
                      </div>
                    ) : (
                      toolCategories.map(({ category, tools }) => {
                        const allOn = tools.every(
                          (tool) => !disabledSet.has(tool.name)
                        );
                        const someOn = tools.some(
                          (tool) => !disabledSet.has(tool.name)
                        );
                        const collapsed = collapsedCategories.has(category);
                        return (
                          <div key={category} className="tools-group">
                            <div className="tools-category">
                              <button
                                type="button"
                                className="tools-caret-btn"
                                onClick={() => toggleCollapse(category)}
                                title={collapsed ? 'Expand' : 'Collapse'}
                                aria-expanded={!collapsed}
                              >
                                {collapsed ? '▸' : '▾'}
                              </button>
                              <button
                                type="button"
                                className="tools-category-toggle"
                                onClick={() => toggleCategory(tools)}
                                title={allOn ? 'Turn all off' : 'Turn all on'}
                              >
                                <span
                                  className={`tools-check ${
                                    allOn
                                      ? 'tools-check-on'
                                      : someOn
                                        ? 'tools-check-partial'
                                        : ''
                                  }`}
                                >
                                  {allOn ? '✓' : someOn ? '–' : ''}
                                </span>
                                <span className="tools-category-label">
                                  {category}
                                </span>
                              </button>
                            </div>
                            {collapsed
                              ? null
                              : tools.map((tool) => {
                                  const on = !disabledSet.has(tool.name);
                                  return (
                                    <button
                                      key={tool.name}
                                      type="button"
                                      className="tools-item"
                                      onClick={() => toggleTool(tool.name)}
                                      title={tool.summary}
                                    >
                                      <span
                                        className={`tools-check ${on ? 'tools-check-on' : ''}`}
                                      >
                                        {on ? '✓' : ''}
                                      </span>
                                      <span className="tools-item-label">
                                        {tool.label}
                                      </span>
                                    </button>
                                  );
                                })}
                          </div>
                        );
                      })
                    )}
                  </div>
                  <div className="settings-popup-section tools-mcp-footer">
                    <button
                      type="button"
                      className="tools-mcp-link"
                      onClick={() => {
                        setShowTools(false);
                        props.onOpenMcpConfig();
                      }}
                      title="Open mcp.json to add or edit MCP servers"
                    >
                      + Configure MCP servers
                    </button>
                  </div>
                </div>
              ) : null}
              <button
                type="button"
                className={`icon-btn ${showTools ? 'icon-btn-active' : ''}`}
                title={
                  props.mcpLoading
                    ? 'Manage tools (loading MCP servers…)'
                    : 'Manage tools'
                }
                disabled={props.compacting}
                onClick={() => setShowTools((s) => !s)}
              >
                {props.mcpLoading ? (
                  <span
                    className="composer-spinner"
                    role="status"
                    aria-label="Loading MCP servers"
                  />
                ) : (
                  <ToolIcon size={14} />
                )}
              </button>
            </div>

            <div className="settings-popup-anchor" ref={settingsRef}>
              {showSettings ? (
                <div className="settings-popup">
                  <div className="settings-popup-section">
                    <div className="settings-popup-heading">
                      Context Management
                    </div>
                    <div className="settings-popup-row">
                      <span className="settings-popup-label">
                        Max file read
                      </span>
                      {editingReadLimit ? (
                        <input
                          className="settings-popup-input"
                          type="number"
                          min={1}
                          value={readLimitDraft}
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                          onChange={(e) => setReadLimitDraft(e.target.value)}
                          onBlur={commitReadLimit}
                          onKeyDown={onReadLimitKeyDown}
                        />
                      ) : (
                        <button
                          type="button"
                          className="settings-popup-value-btn"
                          onClick={() => {
                            setReadLimitDraft(String(props.maxReadLines));
                            setEditingReadLimit(true);
                          }}
                        >
                          {props.maxReadLines} lines
                        </button>
                      )}
                    </div>
                    <div className="settings-popup-row">
                      <span className="settings-popup-label">
                        Max Context Window
                        <span className="settings-popup-hint">
                          set 0 to turn off
                        </span>
                      </span>
                      {editingHistoryLimit ? (
                        <input
                          className="settings-popup-input"
                          type="number"
                          min={0}
                          value={historyLimitDraft}
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                          onChange={(e) => setHistoryLimitDraft(e.target.value)}
                          onBlur={commitHistoryLimit}
                          onKeyDown={onHistoryLimitKeyDown}
                        />
                      ) : (
                        <button
                          type="button"
                          className="settings-popup-value-btn"
                          title="Recent context window items sent to model — 0 means send all"
                          onClick={() => {
                            setHistoryLimitDraft(
                              props.maxHistoryMessages > 0
                                ? String(props.maxHistoryMessages)
                                : '0'
                            );
                            setEditingHistoryLimit(true);
                          }}
                        >
                          {props.maxHistoryMessages > 0
                            ? `${props.maxHistoryMessages} items`
                            : 'All'}
                        </button>
                      )}
                    </div>
                    <div className="settings-popup-row">
                      <span className="settings-popup-label">
                        Auto-compact at
                        <span className="settings-popup-hint">
                          set 0 to turn off
                        </span>
                      </span>
                      {editingAutoCompact ? (
                        <input
                          className="settings-popup-input"
                          type="number"
                          min={0}
                          max={100}
                          value={autoCompactDraft}
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                          onChange={(e) => setAutoCompactDraft(e.target.value)}
                          onBlur={commitAutoCompact}
                          onKeyDown={onAutoCompactKeyDown}
                        />
                      ) : (
                        <button
                          type="button"
                          className="settings-popup-value-btn"
                          title="Compact the conversation automatically when the last request used this share of the context window — 0 turns it off"
                          onClick={() => {
                            setAutoCompactDraft(
                              String(props.autoCompactThresholdPercent)
                            );
                            setEditingAutoCompact(true);
                          }}
                        >
                          {props.autoCompactThresholdPercent > 0
                            ? `${props.autoCompactThresholdPercent}% of context`
                            : 'Off'}
                        </button>
                      )}
                    </div>
                    <div className="settings-popup-row">
                      <span className="settings-popup-label">
                        Lazy tool loading
                      </span>
                      <button
                        type="button"
                        className={`toggle-btn ${props.lazyToolLoading ? 'toggle-on' : ''}`}
                        title={
                          props.lazyToolLoading
                            ? 'On — model loads tools via lazy_load_tools'
                            : 'Off — all tools sent to the model up front'
                        }
                        onClick={props.onToggleLazyToolLoading}
                        aria-pressed={props.lazyToolLoading}
                      >
                        <span className="toggle-knob" />
                      </button>
                    </div>
                  </div>

                  <div className="settings-popup-section">
                    <div className="settings-popup-heading">
                      General Settings
                    </div>
                    <div className="settings-popup-row">
                      <span className="settings-popup-label">
                        Auto approvals
                      </span>
                      <button
                        type="button"
                        className={`toggle-btn ${props.autoApprove ? 'toggle-on' : ''}`}
                        title={
                          props.autoApprove
                            ? 'On — click to disable'
                            : 'Off — click to enable'
                        }
                        onClick={props.onToggleAutoApprove}
                        aria-pressed={props.autoApprove}
                      >
                        <span className="toggle-knob" />
                      </button>
                    </div>
                    <div className="settings-popup-row">
                      <span className="settings-popup-label">
                        Show thinking
                      </span>
                      <button
                        type="button"
                        className={`toggle-btn ${!props.thinkingCollapsed ? 'toggle-on' : ''}`}
                        title={
                          props.thinkingCollapsed
                            ? 'Collapsed — click to expand by default'
                            : 'Expanded — click to collapse by default'
                        }
                        onClick={props.onToggleThinkingCollapsed}
                        aria-pressed={!props.thinkingCollapsed}
                      >
                        <span className="toggle-knob" />
                      </button>
                    </div>
                    <div className="settings-popup-row">
                      <span className="settings-popup-label">
                        Expand tool details
                      </span>
                      <button
                        type="button"
                        className={`toggle-btn ${props.expandTools ? 'toggle-on' : ''}`}
                        title={
                          props.expandTools
                            ? 'On — click to collapse'
                            : 'Off — click to expand'
                        }
                        onClick={props.onToggleExpandTools}
                        aria-pressed={props.expandTools}
                      >
                        <span className="toggle-knob" />
                      </button>
                    </div>
                    <div className="settings-popup-row">
                      <span className="settings-popup-label">
                        Local model refresh
                      </span>
                      <button
                        type="button"
                        className={`toggle-btn ${props.localModelAutoRefresh ? 'toggle-on' : ''}`}
                        title={
                          props.localModelAutoRefresh
                            ? 'On — always refresh local models'
                            : 'Off — local models use the daily cache'
                        }
                        onClick={props.onToggleLocalModelAutoRefresh}
                        aria-pressed={props.localModelAutoRefresh}
                      >
                        <span className="toggle-knob" />
                      </button>
                    </div>
                    <div className="settings-popup-row">
                      <span className="settings-popup-label">
                        Models auto-refresh
                      </span>
                      <button
                        type="button"
                        className={`toggle-btn ${props.modelAutoRefresh ? 'toggle-on' : ''}`}
                        title={
                          props.modelAutoRefresh
                            ? 'On — cached model lists refresh daily'
                            : 'Off — model lists only refresh manually'
                        }
                        onClick={props.onToggleModelAutoRefresh}
                        aria-pressed={props.modelAutoRefresh}
                      >
                        <span className="toggle-knob" />
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
              <button
                type="button"
                className={`icon-btn ${showSettings ? 'icon-btn-active' : ''}`}
                title="Chat settings"
                disabled={props.compacting}
                onClick={() => {
                  if (showSettings) commitPendingSettingsEditsRef.current();
                  setShowSettings((s) => !s);
                }}
              >
                <SlidersIcon size={14} />
              </button>
            </div>

            {busy || props.compacting ? (
              <>
                <span
                  className="composer-spinner"
                  role="status"
                  aria-label="Working"
                  title={props.compacting ? 'Compacting…' : 'Working…'}
                />
                <button
                  type="button"
                  className="icon-btn icon-btn-stop"
                  title={props.compacting ? 'Stop compaction' : 'Stop'}
                  onClick={props.onCancel}
                >
                  <StopIcon />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="icon-btn icon-btn-send"
                title="Send (Enter)"
                disabled={
                  disabled ||
                  (!value.trim() && images.length === 0 && files.length === 0)
                }
                onClick={submit}
              >
                <SendIcon />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="statusbar">
        <div className="statusbar-metrics">
          <span className="status-usage" title="Token usage this session">
            <span className="metric-label">ctx </span>
            <span className="metric-value">
              {formatTokens(props?.usage?.lastInputTokens || 0)}
            </span>
            <span className="metric-label"> in </span>
            <span className="metric-value">
              {formatTokens(props?.usage?.inputTokens || 0)}
            </span>
            <span className="metric-label"> cached </span>
            <span className="metric-value">
              {formatTokens(props?.usage?.cachedTokens || 0)}
            </span>
            <span className="metric-label"> out </span>
            <span className="metric-value">
              {formatTokens(props?.usage?.outputTokens || 0)}
            </span>
            {props?.usage && props?.usage.cost !== undefined ? (
              <>
                <span className="metric-label"> · $</span>
                <span className="metric-value">
                  {props.usage.cost.toFixed(4)}
                </span>
              </>
            ) : null}
          </span>
          <span className="status-stats" title="Latency and throughput">
            <span className="metric-label">TTFT </span>
            <span className="metric-value">
              {formatDuration(props?.stats?.ttftMs || 0)}
            </span>
            <span className="metric-label"> · </span>
            <span className="metric-value">
              {(props?.stats?.tokensPerSecond || 0).toFixed(1)}
            </span>
            <span className="metric-label"> tok/s · AVG </span>
            <span className="metric-value">
              {(props?.stats?.avgTokensPerSecond || 0).toFixed(1)}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The per-mode default-model control shown in the mode popup: a "default: X"
 * pill that opens the model picker to bind a model, plus a clear (✕) button
 * when one is bound. Switching to the mode auto-selects its default model.
 */
function ModeDefaultModelControl({
  label,
  onSet,
  onClear,
}: {
  label: string | null;
  onSet: () => void;
  onClear: () => void;
}): React.JSX.Element {
  return (
    <span className="modes-item-default">
      <button
        type="button"
        className="modes-default-pill"
        title="Set this mode's default model"
        onClick={(e) => {
          e.stopPropagation();
          onSet();
        }}
      >
        {label ? `model: ${label}` : 'set model'}
      </button>
      {label ? (
        <button
          type="button"
          className="modes-item-delete"
          title="Clear this mode's default model"
          aria-label="Clear default model"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
        >
          ✕
        </button>
      ) : null}
    </span>
  );
}

/** Context-pressure styling: amber above 60% full, red above 80%. */
function contextPressureClass(pct: number): string {
  if (pct > 80) return 'context-ring-danger';
  if (pct > 60) return 'context-ring-warn';
  return '';
}

/** Compact token count for the context readout (e.g. 22.1K, 131K, 1M). */
function fmtTokenCount(n: number): string {
  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
}

/** A small circular gauge showing how full the model's context window is. */
function ContextRing({ pct }: { pct: number }): React.JSX.Element {
  const radius = 5.5;
  const circumference = 2 * Math.PI * radius;
  const filled = (Math.min(pct, 100) / 100) * circumference;
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 14 14"
      role="img"
      aria-label={`Context window ${pct}% full`}
    >
      <circle
        cx={7}
        cy={7}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.25}
        strokeWidth={2}
      />
      <circle
        cx={7}
        cy={7}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeDasharray={`${filled} ${circumference}`}
        strokeLinecap="round"
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}

/** Compacts a token count for the footer (817851 → 818k, 8151 → 8.2k, 1234567 → 1.2m). */
function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  const scaled = count < 1_000_000 ? count / 1000 : count / 1_000_000;
  const suffix = count < 1_000_000 ? 'k' : 'm';
  // One decimal while it adds precision (8.2k, 1.2m); whole numbers past 10.
  const rounded =
    scaled < 10 ? Math.round(scaled * 10) / 10 : Math.round(scaled);
  return `${rounded}${suffix}`;
}

/** Formats a millisecond duration the way the CLI footer does (e.g. 1.5s). */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    const rounded = Math.round(totalSeconds * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return seconds > 0 ? `${minutes}min ${seconds}s` : `${minutes}min`;
}
