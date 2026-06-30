import * as React from 'react';

import { APP_NAME } from '@core/branding';
import {
  applyMentionSuggestion,
  applySymbolSuggestion,
  filterMentionSuggestions,
  filterSymbolSuggestions,
  getActiveMentionQuery,
  getActiveSymbolMention,
} from '@core/application/prompt-attachment-service';
import type {
  WebviewImage,
  WebviewModel,
  WebviewReasoningChoice,
  WebviewStats,
  WebviewTool,
  WebviewUsage,
} from '@ext/shared/protocol';
import {
  PlusIcon,
  SendIcon,
  SlidersIcon,
  StopIcon,
  ToolIcon,
} from '@ext/webview/components/Icons';

/**
 * Reads a pasted image File into the base64 form the wire expects (no `data:`
 * URI prefix). Resolves null if the file can't be read.
 */
function readImageFile(
  file: File
): Promise<{ mediaType: string; data: string } | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        resolve(null);
        return;
      }
      const comma = result.indexOf(',');
      resolve({
        mediaType: file.type || 'image/png',
        data: comma >= 0 ? result.slice(comma + 1) : result,
      });
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

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
  onSubmit: (content: string, images: WebviewImage[]) => void;
  onCancel: () => void;
  /** The unsent draft to restore on mount (survives the composer unmounting). */
  initialDraft?: string;
  /** Staged images to restore on mount, paired with {@link initialDraft}. */
  initialImages?: WebviewImage[];
  /** Mirror the live draft up so it persists while a full-screen view is open. */
  onDraftChange?: (draft: string, images: WebviewImage[]) => void;
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
  /** When true, lazy tool loading is on (off = all tools up front). */
  lazyToolLoading: boolean;
  onToggleLazyToolLoading: () => void;
  /** The toggleable tools, grouped by category, for the manage-tools popup. */
  manageableTools: WebviewTool[];
  /** Names of tools currently turned off. */
  disabledTools: string[];
  /** Persist a new full set of disabled tool names. */
  onSetDisabledTools: (names: string[]) => void;
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
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Mirror the draft up on every change so it outlives this component when a
  // full-screen view (model picker, sessions) takes over and unmounts it.
  const { onDraftChange } = props;
  React.useEffect(() => {
    onDraftChange?.(value, images);
  }, [value, images, onDraftChange]);
  const [showSettings, setShowSettings] = React.useState(false);
  const [showReasoning, setShowReasoning] = React.useState(false);
  const [showTools, setShowTools] = React.useState(false);
  // Category headings folded shut in the manage-tools popup (tool rows hidden).
  const [collapsedCategories, setCollapsedCategories] = React.useState<
    Set<string>
  >(new Set());
  const reasoningRef = React.useRef<HTMLDivElement>(null);
  const toolsRef = React.useRef<HTMLDivElement>(null);
  const [readLimitDraft, setReadLimitDraft] = React.useState('');
  const [editingReadLimit, setEditingReadLimit] = React.useState(false);
  const [historyLimitDraft, setHistoryLimitDraft] = React.useState('');
  const [editingHistoryLimit, setEditingHistoryLimit] = React.useState(false);
  const settingsRef = React.useRef<HTMLDivElement>(null);

  // Close the settings popup when clicking outside it.
  React.useEffect(() => {
    if (!showSettings) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (
        settingsRef.current &&
        !settingsRef.current.contains(e.target as Node)
      ) {
        setShowSettings(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [showSettings]);

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

  const disabledSet = React.useMemo(
    () => new Set(props.disabledTools),
    [props.disabledTools]
  );

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
    reasoning?.mandatory && storedEffort === 'off' ? undefined : storedEffort;
  const effectiveEffort: WebviewReasoningChoice =
    usableStored ?? defaultEffort ?? 'off';
  // Mandatory models always reason, so "off" isn't offered; optional ones lead
  // with it (mirrors the CLI's reasoning picker).
  const reasoningChoices: WebviewReasoningChoice[] = reasoning?.mandatory
    ? [...reasoningLevels]
    : ['off', ...reasoningLevels];

  const submit = (): void => {
    const trimmed = value.trim();
    // An image-only message is valid (just a pasted screenshot), so allow a
    // send when there's no prose but at least one image is staged. While a turn
    // is busy this still fires — the parent queues it rather than sending now.
    if ((!trimmed && images.length === 0) || disabled) return;
    props.onSubmit(trimmed, images);
    setValue('');
    setImages([]);
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
  const mentionSuggestions = React.useMemo<string[]>(() => {
    if (symbolMention) {
      return filterSymbolSuggestions(
        props.fileSymbols[symbolMention.path] ?? [],
        symbolMention.query
      );
    }
    if (fileQuery !== undefined) {
      return filterMentionSuggestions(props.workspaceFiles, fileQuery);
    }
    return [];
  }, [symbolMention, fileQuery, props.fileSymbols, props.workspaceFiles]);

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
  };

  const applyMention = (suggestion: string): void => {
    const next = symbolMention
      ? applySymbolSuggestion(value, suggestion)
      : applyMentionSuggestion(value, suggestion);
    changeValue(next);
    textareaRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
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
    const files: File[] = [];
    // DataTransferItemList is array-like but not reliably iterable, so index it.
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item && item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length === 0) return;
    // Keep the textarea from also inserting a file path / nothing for the paste.
    event.preventDefault();
    const read = await Promise.all(files.map(readImageFile));
    const staged = read.filter(
      (r): r is { mediaType: string; data: string } => r !== null
    );
    if (staged.length === 0) return;
    setImages((prev) => [
      ...prev,
      ...staged.map((image, i) => ({
        id: `img-${Date.now()}-${prev.length + i}`,
        ...image,
      })),
    ]);
  };

  const removeImage = (id: string): void => {
    setImages((prev) => prev.filter((image) => image.id !== id));
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

  return (
    <div className="composer-area">
      <div
        className={`composer ${disabled ? 'composer-disabled' : ''} ${
          busy ? 'composer-busy' : ''
        }`}
      >
        {images.length > 0 ? (
          <div className="composer-attachments">
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
        {mentionOpen ? (
          <ul className="composer-mentions" role="listbox">
            {mentionSuggestions.map((suggestion, index) => (
              <li
                key={suggestion}
                role="option"
                aria-selected={index === activeMentionIndex}
                className={`composer-mention ${
                  index === activeMentionIndex ? 'composer-mention-active' : ''
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
                  <>
                    <span className="composer-mention-symbol">
                      {suggestion}
                    </span>
                    <span className="composer-mention-path">
                      {symbolMention.path}
                    </span>
                  </>
                ) : (
                  suggestion
                )}
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          ref={textareaRef}
          className="composer-input"
          value={value}
          rows={2}
          disabled={disabled}
          placeholder={
            disabled
              ? 'Configure a provider to start chatting…'
              : busy
                ? 'Queue a follow-up — sends when this turn finishes…'
                : `Ask ${APP_NAME} to build, fix, or explain…`
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
              onClick={props.onNewSession}
            >
              <PlusIcon />
            </button>

            <span className="toolbar-divider" />

            <button
              type="button"
              className="model-btn"
              title="Change model"
              disabled={props.models.length === 0}
              onClick={props.onOpenModelPicker}
            >
              {(() => {
                const m =
                  props.models.find(
                    (m) =>
                      m.id === props.activeModel &&
                      m.providerId === props.activeProviderId
                  ) ?? props.models.find((m) => m.id === props.activeModel);
                if (!m) return props.activeModel ?? 'No model';
                return `${m.providerName} · ${m.displayName}`;
              })()}
            </button>

            {reasoningSupported && activeModelObj ? (
              <div className="reasoning-popup-anchor" ref={reasoningRef}>
                <button
                  type="button"
                  className={`reasoning-btn ${showReasoning ? 'reasoning-btn-active' : ''}`}
                  title="Thinking level"
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
                        choice !== 'off' && choice === defaultEffort;
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
                            {choice === 'off' ? 'Off' : choice}
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
            <div className="settings-popup-anchor" ref={toolsRef}>
              {showTools ? (
                <div className="settings-popup tools-popup">
                  <div className="settings-popup-section">
                    <div className="settings-popup-heading">Tools</div>
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
                </div>
              ) : null}
              <button
                type="button"
                className={`icon-btn ${showTools ? 'icon-btn-active' : ''}`}
                title="Manage tools"
                onClick={() => setShowTools((s) => !s)}
              >
                <ToolIcon size={14} />
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
                  </div>
                </div>
              ) : null}
              <button
                type="button"
                className={`icon-btn ${showSettings ? 'icon-btn-active' : ''}`}
                title="Chat settings"
                onClick={() => setShowSettings((s) => !s)}
              >
                <SlidersIcon size={14} />
              </button>
            </div>

            {busy ? (
              <>
                <span
                  className="composer-spinner"
                  role="status"
                  aria-label="Working"
                  title="Working…"
                />
                <button
                  type="button"
                  className="icon-btn icon-btn-stop"
                  title="Stop"
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
                disabled={disabled || (!value.trim() && images.length === 0)}
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
              {(props?.usage?.inputTokens || 0).toLocaleString()}
            </span>
            <span className="metric-label"> cached </span>
            <span className="metric-value">
              {(props?.usage?.cachedTokens || 0).toLocaleString()}
            </span>
            <span className="metric-label"> new </span>
            <span className="metric-value">
              {Math.max(
                (props?.usage?.inputTokens || 0) -
                  (props?.usage?.cachedTokens || 0),
                0
              ).toLocaleString()}
            </span>
            <span className="metric-label"> out </span>
            <span className="metric-value">
              {(props?.usage?.outputTokens || 0).toLocaleString()}
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
