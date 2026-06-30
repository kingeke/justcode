/**
 * Message protocol for the Settings editor tab. It runs in its own webview
 * panel (a full editor tab, not the sidebar), so it speaks a protocol separate
 * from the chat {@link ./protocol} to keep the two surfaces from sharing
 * unrelated message shapes. The provider domain types are reused from the chat
 * protocol since both surfaces describe the same providers.
 */

import type { WebviewProvider } from '@ext/shared/protocol';

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
}

/** Per-server outcome of loading MCP, shown after a save. */
export interface SettingsMcpServerStatus {
  name: string;
  ok: boolean;
  toolCount: number;
  error?: string | undefined;
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
  section: 'mcp';
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
  | SettingsFocusSectionMessage;

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
  | SettingsSaveMcpConfigMessage;
