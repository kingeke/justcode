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
  /** The installed skills of both scopes, in response to GetSkills / actions. */
  Skills = 'skills',
  /** Outcome of an AddSkill / UpdateSkill / RemoveSkill action. */
  SkillActionResult = 'skillActionResult',
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
  /** Create a new custom sub agent (name + optional summary/prompt). */
  CreateSubAgent = 'createSubAgent',
  /** Delete a custom mode (built-ins can never be deleted). */
  DeleteMode = 'deleteMode',
  /** Bind a default model to a mode or sub agent (by its prompt id). */
  SetPromptDefaultModel = 'setPromptDefaultModel',
  /** Clear a mode's or sub agent's default model. */
  ClearPromptDefaultModel = 'clearPromptDefaultModel',
  /** Open the raw `config.json` in a VS Code editor tab. */
  OpenConfigFile = 'openConfigFile',
  /** Ask the host for the installed skills (both scopes). */
  GetSkills = 'getSkills',
  /** Install a skill from a git repository into a scope. */
  AddSkill = 'addSkill',
  /** Uninstall a skill from a scope. */
  RemoveSkill = 'removeSkill',
  /** Update an installed skill from its repository. */
  UpdateSkill = 'updateSkill',
}

/**
 * Prefix that scopes sub agent entries in the prompt list's id namespace
 * (`subagent-explorer`, `subagent-<custom id>`), so they can't collide with
 * mode ids in the shared save/delete routing and so both sides can section the
 * list without duplicating the literal.
 */
export const SUB_AGENT_PROMPT_ID_PREFIX = 'subagent-';

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
  /** One-line blurb shown under the name (a mode's role / an agent's summary). */
  description: string;
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
  /**
   * Whether this entry can carry a default model. True for chat modes and sub
   * agents; false for the Compaction prompt, which is not a mode.
   */
  supportsDefaultModel?: boolean;
  /** The bound default model, when one is set for this mode/sub agent. */
  defaultModel?: SettingsModelReference | undefined;
}

/** A provider+model pointer, mirroring `@core`'s ModelReference. */
export interface SettingsModelReference {
  providerId: string;
  modelId: string;
}

/** One model the user can bind as a default, for the Settings picker. */
export interface SettingsModelOption {
  id: string;
  displayName: string;
  providerId: string;
  providerName: string;
}

/** Where a skill is installed; mirrors `@core` SkillScope. */
export enum SettingsSkillScope {
  Local = 'local',
  Global = 'global',
}

/** One slash command a skill contributes, as shown on the Skills tab. */
export interface SettingsSkillCommand {
  name: string;
  description?: string | undefined;
  argumentHint?: string | undefined;
}

/** An installed skill, as listed on the Skills tab. */
export interface SettingsSkill {
  name: string;
  version: string;
  description?: string | undefined;
  author?: string | undefined;
  /** Where the skill was installed from (git URL), when known. */
  source?: string | undefined;
  scope: SettingsSkillScope;
  commands: SettingsSkillCommand[];
  /** Command files that failed to parse; the rest of the skill still works. */
  errors: string[];
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
  /**
   * Every model across the connected providers, so a mode/sub agent card can
   * offer a default-model picker. Empty when no provider is connected (or none
   * could be listed) — the picker then shows nothing to choose.
   */
  models: SettingsModelOption[];
}

/** Outcome of a SavePrompt attempt. */
export interface SettingsPromptSaveResultMessage {
  type: SettingsHostMessageType.PromptSaveResult;
  modeId: string;
  success: boolean;
  error?: string | undefined;
}

/**
 * The installed skills of both scopes, sent in response to GetSkills and after
 * every add/update/remove so the list is always fresh.
 */
export interface SettingsSkillsMessage {
  type: SettingsHostMessageType.Skills;
  skills: SettingsSkill[];
  /** Skills that failed to load entirely (broken installs). */
  errors: string[];
  /** False when no workspace folder is open, so local installs are disabled. */
  workspaceOpen: boolean;
}

/** The kind of skill mutation an action result describes. */
export enum SkillActionKind {
  Add = 'add',
  Update = 'update',
  Remove = 'remove',
}

/** Outcome of an AddSkill / UpdateSkill / RemoveSkill action. */
export interface SettingsSkillActionResultMessage {
  type: SettingsHostMessageType.SkillActionResult;
  action: SkillActionKind;
  success: boolean;
  /** Success summary or failure reason, shown under the form/list. */
  message: string;
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
  | SettingsPromptSaveResultMessage
  | SettingsSkillsMessage
  | SettingsSkillActionResultMessage;

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
  /**
   * The `claude` executable path for direct-connect providers (Claude Code).
   * Blank/omitted means "let the Agent SDK resolve it".
   */
  executablePath?: string | undefined;
  /**
   * `CLAUDE_CONFIG_DIR` (account/login dir) for direct-connect providers.
   * Blank/omitted means the default (`~/.claude`).
   */
  configDir?: string | undefined;
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
  /** Bind this model as the new mode's default; omitted = no default. */
  defaultModel?: SettingsModelReference | undefined;
}

/**
 * Create a new custom sub agent from the System Prompts tab. The id is derived
 * from the name (deduped against the built-in agent types and existing custom
 * agents). An empty prompt means the agent falls back to the General sub agent
 * prompt; `readOnly` restricts it to the read-only Explorer toolset. The host
 * replies with PromptSaveResult (modeId = `subagent-<id>`) and a fresh Prompts
 * list.
 */
export interface SettingsCreateSubAgentMessage {
  type: SettingsWebviewMessageType.CreateSubAgent;
  name: string;
  summary: string;
  prompt: string;
  readOnly: boolean;
  /** Bind this model as the new sub agent's default; omitted = no default. */
  defaultModel?: SettingsModelReference | undefined;
}

/**
 * Delete a custom mode (or custom sub agent, by its `subagent-<id>` prompt id)
 * from the System Prompts tab. The host removes it from config (switching the
 * active mode to Build when it was the deleted one) and replies with
 * PromptSaveResult and a fresh Prompts list.
 */
export interface SettingsDeleteModeMessage {
  type: SettingsWebviewMessageType.DeleteMode;
  modeId: string;
}

/**
 * Bind a default model to the mode (or sub agent, by its `subagent-<id>` prompt
 * id) so switching to that mode — or spawning that sub agent — uses the model.
 * The host persists it and replies with a fresh Prompts list.
 */
export interface SettingsSetPromptDefaultModelMessage {
  type: SettingsWebviewMessageType.SetPromptDefaultModel;
  /** A mode id, or a `subagent-<id>` prompt id. */
  promptId: string;
  modelId: string;
  providerId: string;
}

/** Clear the default model bound to a mode or sub agent. */
export interface SettingsClearPromptDefaultModelMessage {
  type: SettingsWebviewMessageType.ClearPromptDefaultModel;
  promptId: string;
}

/** Ask the host to open `config.json` in a VS Code editor tab. */
export interface SettingsOpenConfigFileMessage {
  type: SettingsWebviewMessageType.OpenConfigFile;
}

/** Ask the host for the installed skills of both scopes. */
export interface SettingsGetSkillsMessage {
  type: SettingsWebviewMessageType.GetSkills;
}

/**
 * Install a skill from a git repository (owner/repo shorthand or a URL) into
 * the given scope. The host replies with SkillActionResult and a fresh Skills
 * list.
 */
export interface SettingsAddSkillMessage {
  type: SettingsWebviewMessageType.AddSkill;
  source: string;
  scope: SettingsSkillScope;
}

/** Uninstall a skill from a scope. Replies like AddSkill. */
export interface SettingsRemoveSkillMessage {
  type: SettingsWebviewMessageType.RemoveSkill;
  name: string;
  scope: SettingsSkillScope;
}

/** Update an installed skill from its repository. Replies like AddSkill. */
export interface SettingsUpdateSkillMessage {
  type: SettingsWebviewMessageType.UpdateSkill;
  name: string;
  scope: SettingsSkillScope;
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
  | SettingsCreateSubAgentMessage
  | SettingsDeleteModeMessage
  | SettingsSetPromptDefaultModelMessage
  | SettingsClearPromptDefaultModelMessage
  | SettingsOpenConfigFileMessage
  | SettingsGetSkillsMessage
  | SettingsAddSkillMessage
  | SettingsRemoveSkillMessage
  | SettingsUpdateSkillMessage;
