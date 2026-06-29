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
}

/** Discriminator for messages sent from the settings webview to the host. */
export enum SettingsWebviewMessageType {
  Init = 'init',
  ListProviders = 'listProviders',
  ConnectProvider = 'connectProvider',
  TestConnectProvider = 'testConnectProvider',
  DisconnectProvider = 'disconnectProvider',
  ResetApp = 'resetApp',
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

export type SettingsHostToWebview =
  | SettingsSnapshotMessage
  | SettingsProvidersUpdateMessage
  | SettingsConnectResultMessage;

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

export interface SettingsDisconnectProviderMessage {
  type: SettingsWebviewMessageType.DisconnectProvider;
  providerId: string;
}

export interface SettingsResetAppMessage {
  type: SettingsWebviewMessageType.ResetApp;
}

export type SettingsWebviewToHost =
  | SettingsInitMessage
  | SettingsListProvidersMessage
  | SettingsConnectProviderMessage
  | SettingsTestConnectMessage
  | SettingsDisconnectProviderMessage
  | SettingsResetAppMessage;
