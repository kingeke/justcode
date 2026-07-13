import * as React from 'react';

import { InfoIcon } from '@ext/webview/components/Icons';

/**
 * Identifies each setting shown in the composer's settings popup. Used to
 * track which setting's info text is currently expanded and to look up its
 * description.
 */
export enum ComposerSettingId {
  MaxFileRead = 'maxFileRead',
  MaxContextWindow = 'maxContextWindow',
  AutoCompactAt = 'autoCompactAt',
  LazyToolLoading = 'lazyToolLoading',
  AutoApprovals = 'autoApprovals',
  ShowThinking = 'showThinking',
  ExpandToolDetails = 'expandToolDetails',
  LocalModelRefresh = 'localModelRefresh',
  ModelsAutoRefresh = 'modelsAutoRefresh',
}

/** Plain-language description of what each composer setting does. */
export const COMPOSER_SETTING_INFO: Record<ComposerSettingId, string> = {
  [ComposerSettingId.MaxFileRead]:
    'Maximum number of lines a single file read returns. Longer files are paged in chunks so large files never flood the context window.',
  [ComposerSettingId.MaxContextWindow]:
    'Caps how many recent context-window items are sent to the model on each request. Older items are left out of the request but stay in the transcript. Set 0 to always send everything.',
  [ComposerSettingId.AutoCompactAt]:
    'Automatically compacts (summarizes) the conversation when the last request used this share of the model’s context window. Set 0 to turn auto-compaction off.',
  [ComposerSettingId.LazyToolLoading]:
    'When on, only a minimal set of tools is sent up front and the model loads the rest on demand, keeping prompts smaller. When off, every tool is sent with each request.',
  [ComposerSettingId.AutoApprovals]:
    'Runs tool calls such as file edits and shell commands without asking for confirmation first. Turn off to review and approve each tool call.',
  [ComposerSettingId.ShowThinking]:
    'Expands the model’s thinking blocks in the transcript by default. Turn off to keep them collapsed until clicked.',
  [ComposerSettingId.ExpandToolDetails]:
    'Expands tool call details in the transcript by default so inputs and results are visible without clicking.',
  [ComposerSettingId.LocalModelRefresh]:
    'Always re-fetches the model list from local providers instead of using the daily cache, so newly pulled local models show up immediately.',
  [ComposerSettingId.ModelsAutoRefresh]:
    'Refreshes cached provider model lists once a day automatically. Turn off to only refresh model lists manually.',
};

export interface SettingInfoButtonProps {
  id: ComposerSettingId;
  open: boolean;
  onToggle: (id: ComposerSettingId) => void;
}

/**
 * Small "ⓘ" button rendered next to a setting label. Clicking it toggles the
 * matching `SettingInfoText` description below the row.
 */
export function SettingInfoButton(
  props: SettingInfoButtonProps
): React.JSX.Element {
  return (
    <button
      type="button"
      className={`settings-info-btn ${props.open ? 'settings-info-btn-active' : ''}`}
      title="What this setting does"
      aria-label="What this setting does"
      aria-expanded={props.open}
      onClick={(e) => {
        e.stopPropagation();
        props.onToggle(props.id);
      }}
    >
      <InfoIcon size={11} />
    </button>
  );
}

export interface SettingInfoTextProps {
  id: ComposerSettingId;
  open: boolean;
}

/** Inline description for a setting, shown while its info button is active. */
export function SettingInfoText(
  props: SettingInfoTextProps
): React.JSX.Element | null {
  if (!props.open) return null;
  return (
    <div className="settings-popup-info">{COMPOSER_SETTING_INFO[props.id]}</div>
  );
}
