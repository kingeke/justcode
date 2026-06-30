import * as React from 'react';

import { APP_NAME } from '@core/branding';
import type {
  WebviewImage,
  WebviewModel,
  WebviewReasoningChoice,
  WebviewStats,
  WebviewUsage,
} from '@ext/shared/protocol';
import {
  PlusIcon,
  SendIcon,
  SlidersIcon,
  StopIcon,
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
  autoApplyWrites: boolean;
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
  onNewSession: () => void;
  onOpenModelPicker: () => void;
  /** Opens a full-size preview of a staged image (data URL). */
  onOpenImage?: (src: string) => void;
  onToggleAutoWrites: () => void;
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
}

/**
 * The Copilot-style composer: one rounded box holding the prompt, an in-box
 * toolbar (new · mode · model · provider · send), and a settings strip beneath
 * it (auto writes · expand · read limit · usage). Enter submits; Shift+Enter
 * inserts a newline, matching the CLI.
 */
export function Composer(props: ComposerProps): React.JSX.Element {
  const { busy, disabled } = props;
  const [value, setValue] = React.useState('');
  const [images, setImages] = React.useState<WebviewImage[]>([]);
  const [showSettings, setShowSettings] = React.useState(false);
  const [showReasoning, setShowReasoning] = React.useState(false);
  const reasoningRef = React.useRef<HTMLDivElement>(null);
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

  // The active model and its reasoning capability, used to offer a thinking-
  // level picker only for models the provider reports as reasoning-capable.
  const activeModelObj =
    props.models.find(
      (m) =>
        m.id === props.activeModel &&
        m.providerId === props.activeProviderId
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
    // send when there's no prose but at least one image is staged.
    if ((!trimmed && images.length === 0) || busy || disabled) return;
    props.onSubmit(trimmed, images);
    setValue('');
    setImages([]);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
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
      <div className={`composer ${disabled ? 'composer-disabled' : ''}`}>
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
        <textarea
          className="composer-input"
          value={value}
          rows={2}
          disabled={disabled}
          placeholder={
            disabled
              ? 'Configure a provider to start chatting…'
              : `Ask ${APP_NAME} to build, fix, or explain…`
          }
          onChange={(event) => setValue(event.target.value)}
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
            <div className="settings-popup-anchor" ref={settingsRef}>
              {showSettings ? (
                <div className="settings-popup">
                  <div className="settings-popup-row">
                    <span className="settings-popup-label">Show thinking</span>
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
                    <span className="settings-popup-label">Auto writes</span>
                    <button
                      type="button"
                      className={`toggle-btn ${props.autoApplyWrites ? 'toggle-on' : ''}`}
                      title={
                        props.autoApplyWrites
                          ? 'On — click to disable'
                          : 'Off — click to enable'
                      }
                      onClick={props.onToggleAutoWrites}
                      aria-pressed={props.autoApplyWrites}
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
                    <span className="settings-popup-label">Max file read</span>
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
                    <span className="settings-popup-label">Context Window</span>
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
              <button
                type="button"
                className="icon-btn icon-btn-stop"
                title="Stop"
                onClick={props.onCancel}
              >
                <StopIcon />
              </button>
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
