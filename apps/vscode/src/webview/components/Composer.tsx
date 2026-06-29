import * as React from 'react';

import { APP_NAME } from '@core/branding';
import type {
  WebviewModel,
  WebviewUsage,
} from '@ext/shared/protocol';
import {
  CodeIcon,
  PlusIcon,
  SendIcon,
  StopIcon,
} from '@ext/webview/components/Icons';

export interface ComposerProps {
  busy: boolean;
  disabled: boolean;
  models: WebviewModel[];
  activeModel: string | undefined;
  activeProviderId: string | undefined;
  usage: WebviewUsage | undefined;
  autoApplyWrites: boolean;
  expandTools: boolean;
  maxReadLines: number;
  onSubmit: (content: string) => void;
  onCancel: () => void;
  onNewSession: () => void;
  onOpenModelPicker: () => void;
  onToggleAutoWrites: () => void;
  onToggleExpandTools: () => void;
  onSetReadLimit: (lines: number) => void;
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
  const [editingReadLimit, setEditingReadLimit] = React.useState(false);
  const [readLimitDraft, setReadLimitDraft] = React.useState('');

  const submit = (): void => {
    const trimmed = value.trim();
    if (!trimmed || busy || disabled) return;
    props.onSubmit(trimmed);
    setValue('');
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

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

  return (
    <div className="composer-area">
      <div className={`composer ${disabled ? 'composer-disabled' : ''}`}>
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

          </div>

          <div className="toolbar-right">
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
                disabled={disabled || !value.trim()}
                onClick={submit}
              >
                <SendIcon />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="statusbar">
        <button
          type="button"
          className={`status-btn ${props.autoApplyWrites ? 'status-btn-active' : ''}`}
          title={
            props.autoApplyWrites
              ? 'Auto writes on — click to require approval'
              : 'Auto writes off — click to skip approval prompts'
          }
          onClick={props.onToggleAutoWrites}
        >
          Auto writes: {props.autoApplyWrites ? 'On' : 'Off'}
        </button>
        <span className="toolbar-divider" />
        <button
          type="button"
          className={`status-btn ${props.expandTools ? 'status-btn-active' : ''}`}
          title={
            props.expandTools
              ? 'Tool details expanded — click to collapse'
              : 'Tool details collapsed — click to expand'
          }
          onClick={props.onToggleExpandTools}
        >
          Expand: {props.expandTools ? 'On' : 'Off'}
        </button>
        <span className="toolbar-divider" />
        {editingReadLimit ? (
          <input
            className="status-read-input"
            type="number"
            min={1}
            value={readLimitDraft}
            autoFocus
            onChange={(e) => setReadLimitDraft(e.target.value)}
            onBlur={commitReadLimit}
            onKeyDown={onReadLimitKeyDown}
          />
        ) : (
          <button
            type="button"
            className="status-btn"
            title="Max lines per file read — click to change"
            onClick={() => {
              setReadLimitDraft(String(props.maxReadLines));
              setEditingReadLimit(true);
            }}
          >
            Max File Read: {props.maxReadLines} Lines
          </button>
        )}
        <span className="status-spacer" />
        {props.usage ? (
          <span className="status-usage" title="Tokens this session">
            {props.usage.inputTokens + props.usage.outputTokens} tok
            {props.usage.cost !== undefined
              ? ` · $${props.usage.cost.toFixed(4)}`
              : ''}
          </span>
        ) : null}
        {busy ? <span className="spinner" aria-label="Working" /> : null}
      </div>
    </div>
  );
}
