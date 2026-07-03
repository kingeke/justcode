/**
 * Message protocol for the Settings editor tab. It runs in its own webview
 * panel (a full editor tab, not the sidebar), so it speaks a protocol separate
 * from the chat {@link ./protocol} to keep the two surfaces from sharing
 * unrelated message shapes. The provider domain types are reused from the chat
 * protocol since both surfaces describe the same providers.
 */

import type { SettingsSection, WebviewProvider } from '@ext/shared/protocol';

/** Discriminator for messages sent from the host to the settings webview. */
export enum SettingsHostMessageType {
  /** Full snapshot: app info + provider list. Sent on init and on refresh. */
  Snapshot = 'snapshot',
  /** Just the provider list, after a connect/disconnect. */
  ProvidersUpdate = 'providersUpdate',
  /** Result of a TestConnectProvider attempt. */
  ConnectResult = 'connectResult',
  /** A progress/instruction line emitted while an OAuth sign-in is running. */
  OAuthStatus = 'oauthStatus',
  /** The OAuth flow needs the user to paste a value (e.g. an auth code). */
  OAuthPrompt = 'oauthPrompt',
  /** Final result of an OAuthConnectProvider attempt. */
  OAuthResult = 'oauthResult',
  /** The raw text of `mcp.json`, in response to GetMcpConfig. */
  McpConfig = 'mcpConfig',
  /** Outcome of a SaveMcpConfig attempt (validation + live reload). */
  McpSaveResult = 'mcpSaveResult',
  /** Asks the settings UI to focus a specific section/tab (e.g. MCP). */
  FocusSection = 'focusSection',
  /** The full system-prompt list (built-in + custom modes). */
  Prompts = 'prompts',
  /** Outcome of a SavePrompt attempt. */
  PromptSaveResult = 'promptSaveResult',
}

/** Discriminator for messages sent from the settings webview to the host. */
export enum SettingsWebviewMessageType {
  Init = 'init',
  ListProviders = 'listProviders',
  ConnectProvider = 'connectProvider',
  TestConnectProvider = 'testConnectProvider',
  /** Run an OAuth sign-in for a provider entirely inside the extension. */
  OAuthConnectProvider = 'oauthConnectProvider',
  /** The user's reply to a preceding OAuthPrompt. */
  OAuthInput = 'oauthInput',
  /** Abort an in-progress OAuth sign-in. */
  CancelOAuth = 'cancelOAuth',
  DisconnectProvider = 'disconnectProvider',
  ResetApp = 'resetApp',
  AddCustomProvider = 'addCustomProvider',
  /** Ask the host for the current `mcp.json` text. */
  GetMcpConfig = 'getMcpConfig',
  /** Persist new `mcp.json` text and reconnect MCP servers. */
  SaveMcpConfig = 'saveMcpConfig',
  /** Ask the host for the system prompts of every mode. */
  GetPrompts = 'getPrompts',
  /** Persist a mode's system prompt (empty resets a built-in to its default). */
  SavePrompt = 'savePrompt',
  /** Create a new custom mode (name + optional prompt). */
  CreateMode = 'createMode',
  /** Open the raw `config.json` in a VS Code editor tab. */
  OpenConfigFile = 'openConfigFile',
}

/** Per-server outcome of loading MCP, shown after a save. */
export interface SettingsMcpServerStatus {
  name: string;
  ok: boolean;
  toolCount: number;
  error?: string | undefined;
}

/** A mode's system prompt as shown/edited on the System Prompts tab. */
export interface SettingsPromptInfo {
  /** Mode id (`build`/`ask`/`plan` or a custom mode's config key). */
  id: string;
  /** Human label shown as the card title. */
  name: string;
  /** Whether the user created this mode (vs. a built-in). */
  custom: boolean;
  /**
   * The effective prompt text. For built-ins this is the config override or
   * the built-in default; for custom modes it may be empty, meaning the mode
   * falls back to the Build prompt.
   */
  prompt: string;
  /** True when a built-in's prompt is overridden in config (reset available). */
  overridden: boolean;
}

/** Static product details rendered on the About tab. */
export interface SettingsAppInfo {
  name: string;
  version: string;
  description: string;
  repository?: string;
  issues?: string;
}

// --- Host -> Webview -------------------------------------------------------

export interface SettingsSnapshotMessage {
  type: SettingsHostMessageType.Snapshot;
  appInfo: SettingsAppInfo;
  providers: WebviewProvider[];
}

export interface SettingsProvidersUpdateMessage {
  type: SettingsHostMessageType.ProvidersUpdate;
  providers: WebviewProvider[];
}

/** Sent after TestConnectProvider — carries success/failure back to the form. */
export interface SettingsConnectResultMessage {
  type: SettingsHostMessageType.ConnectResult;
  success: boolean;
  error?: string | undefined;
}

/** A status/instruction line shown while an OAuth sign-in is in progress. */
export interface SettingsOAuthStatusMessage {
  type: SettingsHostMessageType.OAuthStatus;
  message: string;
}

/** Asks the webview to collect a value the OAuth flow needs (e.g. a code). */
export interface SettingsOAuthPromptMessage {
  type: SettingsHostMessageType.OAuthPrompt;
  label: string;
}

/** Sent after OAuthConnectProvider — carries success/failure back to the UI. */
export interface SettingsOAuthResultMessage {
  type: SettingsHostMessageType.OAuthResult;
  success: boolean;
  error?: string | undefined;
}

/** The current `mcp.json` text, sent in response to GetMcpConfig. */
export interface SettingsMcpConfigMessage {
  type: SettingsHostMessageType.McpConfig;
  content: string;
}

/** Outcome of a SaveMcpConfig: parse/validation status and per-server results. */
export interface SettingsMcpSaveResultMessage {
  type: SettingsHostMessageType.McpSaveResult;
  success: boolean;
  /** Set when the JSON failed to parse/validate (nothing was saved). */
  error?: string | undefined;
  /** Per-server load outcome after a successful save + reconnect. */
  servers?: SettingsMcpServerStatus[];
}

/** Asks the settings UI to switch to a section (e.g. when opened for MCP). */
export interface SettingsFocusSectionMessage {
  type: SettingsHostMessageType.FocusSection;
  section: SettingsSection;
}

/** The system prompts of every mode, sent on request and after each save. */
export interface SettingsPromptsMessage {
  type: SettingsHostMessageType.Prompts;
  prompts: SettingsPromptInfo[];
}

/** Outcome of a SavePrompt attempt. */
export interface SettingsPromptSaveResultMessage {
  type: SettingsHostMessageType.PromptSaveResult;
  modeId: string;
  success: boolean;
  error?: string | undefined;
}

export type SettingsHostToWebview =
  | SettingsSnapshotMessage
  | SettingsProvidersUpdateMessage
  | SettingsConnectResultMessage
  | SettingsOAuthStatusMessage
  | SettingsOAuthPromptMessage
  | SettingsOAuthResultMessage
  | SettingsMcpConfigMessage
  | SettingsMcpSaveResultMessage
  | SettingsFocusSectionMessage
  | SettingsPromptsMessage
  | SettingsPromptSaveResultMessage;

// --- Webview -> Host -------------------------------------------------------

export interface SettingsInitMessage {
  type: SettingsWebviewMessageType.Init;
}

export interface SettingsListProvidersMessage {
  type: SettingsWebviewMessageType.ListProviders;
}

export interface SettingsConnectProviderMessage {
  type: SettingsWebviewMessageType.ConnectProvider;
}

/**
 * Ask the host to validate credentials by calling listModels(), then persist
 * them if the connection succeeds. The host replies with ConnectResult.
 */
export interface SettingsTestConnectMessage {
  type: SettingsWebviewMessageType.TestConnectProvider;
  providerId: string;
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
}

/**
 * Ask the host to run the provider's OAuth sign-in flow end-to-end (open the
 * browser, capture the redirect/device code, mint and persist credentials). The
 * host streams OAuthStatus/OAuthPrompt updates and finishes with OAuthResult.
 */
export interface SettingsOAuthConnectMessage {
  type: SettingsWebviewMessageType.OAuthConnectProvider;
  providerId: string;
}

/** The user's reply to a preceding OAuthPrompt. */
export interface SettingsOAuthInputMessage {
  type: SettingsWebviewMessageType.OAuthInput;
  value: string;
}

/** Abort an in-progress OAuth sign-in (e.g. the user cancelled). */
export interface SettingsCancelOAuthMessage {
  type: SettingsWebviewMessageType.CancelOAuth;
}

export interface SettingsDisconnectProviderMessage {
  type: SettingsWebviewMessageType.DisconnectProvider;
  providerId: string;
}

export interface SettingsResetAppMessage {
  type: SettingsWebviewMessageType.ResetApp;
}

export interface SettingsAddCustomProviderMessage {
  type: SettingsWebviewMessageType.AddCustomProvider;
  name: string;
  apiKey?: string | undefined;
  baseUrl: string;
}

export interface SettingsGetMcpConfigMessage {
  type: SettingsWebviewMessageType.GetMcpConfig;
}

export interface SettingsSaveMcpConfigMessage {
  type: SettingsWebviewMessageType.SaveMcpConfig;
  /** The full new text to write to `mcp.json`. */
  content: string;
}

export interface SettingsGetPromptsMessage {
  type: SettingsWebviewMessageType.GetPrompts;
}

/**
 * Persist a mode's system prompt. For a built-in mode an empty prompt (or one
 * identical to the built-in default) clears the config override, restoring the
 * default. For a custom mode an empty prompt makes it fall back to the Build
 * prompt. The host replies with PromptSaveResult and a fresh Prompts list.
 */
export interface SettingsSavePromptMessage {
  type: SettingsWebviewMessageType.SavePrompt;
  modeId: string;
  prompt: string;
}

/**
 * Create a new custom mode from the System Prompts tab. The id is derived from
 * the name (deduped against built-ins and existing modes). An empty prompt
 * means the mode falls back to the Build prompt. The host replies with
 * PromptSaveResult (modeId = the new mode's id) and a fresh Prompts list.
 */
export interface SettingsCreateModeMessage {
  type: SettingsWebviewMessageType.CreateMode;
  name: string;
  prompt: string;
}

/** Ask the host to open `config.json` in a VS Code editor tab. */
export interface SettingsOpenConfigFileMessage {
  type: SettingsWebviewMessageType.OpenConfigFile;
}

export type SettingsWebviewToHost =
  | SettingsInitMessage
  | SettingsListProvidersMessage
  | SettingsConnectProviderMessage
  | SettingsTestConnectMessage
  | SettingsOAuthConnectMessage
  | SettingsOAuthInputMessage
  | SettingsCancelOAuthMessage
  | SettingsDisconnectProviderMessage
  | SettingsResetAppMessage
  | SettingsAddCustomProviderMessage
  | SettingsGetMcpConfigMessage
  | SettingsSaveMcpConfigMessage
  | SettingsGetPromptsMessage
  | SettingsSavePromptMessage
  | SettingsCreateModeMessage
  | SettingsOpenConfigFileMessage;
