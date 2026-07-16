/**
 * The message protocol spoken between the extension host (Node) and the chat
 * webview (browser). Both sides import these types so a change to a message
 * shape is a compile error on the other end rather than a runtime surprise.
 *
 * Kept dependency-free on purpose: it is bundled into the webview, which must
 * not pull in `node:`-flavored modules. The few domain shapes it needs are
 * re-declared here as plain data rather than imported from `@core`.
 */

/** Discriminator for messages sent from the extension host to the webview. */
export enum HostMessageType {
  Ready = 'ready',
  SessionsList = 'sessionsList',
  TitleUpdate = 'titleUpdate',
  Token = 'token',
  Thinking = 'thinking',
  ToolActivity = 'toolActivity',
  /** Live progress of a sub agent spawned by the `task` tool. */
  SubAgentActivity = 'subAgentActivity',
  SubAgentTranscript = 'subAgentTranscript',
  ApprovalRequest = 'approvalRequest',
  UserInputRequest = 'userInputRequest',
  UsageUpdate = 'usageUpdate',
  TurnComplete = 'turnComplete',
  ModelsUpdate = 'modelsUpdate',
  /** MCP servers finished connecting in the background; refresh tools + spinner. */
  McpStatus = 'mcpStatus',
  /** The mode list or active mode changed (select/create), without a full reload. */
  ModeUpdate = 'modeUpdate',
  /** The per-mode/per-sub-agent default models changed (bind/clear). */
  ModelDefaultsUpdate = 'modelDefaultsUpdate',
  /** The installed skills changed (via Settings); refresh the `/` completions. */
  SkillCommandsUpdate = 'skillCommandsUpdate',
  /** A transient status line shown above the transcript (no full reload). */
  Notice = 'notice',
  /** A compaction started or finished; drives the busy state and error surface. */
  CompactStatus = 'compactStatus',
  FileReverted = 'fileReverted',
  SteeringConsumed = 'steeringConsumed',
  WorkspaceFiles = 'workspaceFiles',
  FileSymbols = 'fileSymbols',
  /** Dropped file paths the host read from disk, ready to stage as chips. */
  DroppedFilesLoaded = 'droppedFilesLoaded',
  Error = 'error',
}

/** Discriminator for messages sent from the webview to the extension host. */
export enum WebviewMessageType {
  Init = 'init',
  Submit = 'submit',
  /** Re-send a previous user message, discarding it and everything after it. */
  Retry = 'retry',
  Cancel = 'cancel',
  ApprovalResponse = 'approvalResponse',
  UserInputResponse = 'userInputResponse',
  SelectModel = 'selectModel',
  SetReasoningEffort = 'setReasoningEffort',
  RefreshModels = 'refreshModels',
  SelectProvider = 'selectProvider',
  NewSession = 'newSession',
  ToggleAutoApprove = 'toggleAutoApprove',
  ToggleExpandTools = 'toggleExpandTools',
  SetReadLimit = 'setReadLimit',
  SetHistoryLimit = 'setHistoryLimit',
  /** Summarize the conversation and continue from the compact summary. */
  CompactSession = 'compactSession',
  /** Set the auto-compact threshold percent (0 = off). */
  SetAutoCompactThreshold = 'setAutoCompactThreshold',
  ToggleThinkingCollapsed = 'toggleThinkingCollapsed',
  ToggleLocalModelAutoRefresh = 'toggleLocalModelAutoRefresh',
  /** Toggle the daily auto-refresh of cached model lists (off = manual only). */
  ToggleModelAutoRefresh = 'toggleModelAutoRefresh',
  ToggleLazyToolLoading = 'toggleLazyToolLoading',
  SetDisabledTools = 'setDisabledTools',
  SelectMode = 'selectMode',
  /** Bind (or clear) the default model for a mode or a sub agent. */
  SetDefaultModel = 'setDefaultModel',
  ClearDefaultModel = 'clearDefaultModel',
  CreateMode = 'createMode',
  /** Delete a custom mode (built-ins can never be deleted). */
  DeleteMode = 'deleteMode',
  /** Write the plan to a new markdown file, open it, and switch to Build mode. */
  EditPlan = 'editPlan',
  ListSessions = 'listSessions',
  OpenSession = 'openSession',
  RenameSession = 'renameSession',
  /** Pin or unpin a session so it lists in its own group above the rest. */
  PinSession = 'pinSession',
  DeleteSession = 'deleteSession',
  ClearSessions = 'clearSessions',
  ConnectProvider = 'connectProvider',
  OpenSettings = 'openSettings',
  RevertFile = 'revertFile',
  OpenFile = 'openFile',
  OpenDiff = 'openDiff',
  OpenMcpConfig = 'openMcpConfig',
  ViewChatLog = 'viewChatLog',
  SaveResolvedFiles = 'saveResolvedFiles',
  SyncSteeringQueue = 'syncSteeringQueue',
  RequestWorkspaceFiles = 'requestWorkspaceFiles',
  RequestSubAgentTranscript = 'requestSubAgentTranscript',
  RequestFileSymbols = 'requestFileSymbols',
  /**
   * The user dropped files that arrived as paths (`text/uri-list`, e.g. a drag
   * from the VS Code explorer) rather than File objects; the host reads them
   * from disk and answers with DroppedFilesLoaded.
   */
  AttachDroppedPaths = 'attachDroppedPaths',
}

/** Roles the transcript renders. Mirrors the persisted message roles. */
export enum WebviewRole {
  User = 'user',
  Assistant = 'assistant',
  Tool = 'tool',
  System = 'system',
}

/** Whether a tool-activity event marks the start or end of an invocation. */
export enum ToolPhase {
  Start = 'start',
  End = 'end',
}

/**
 * An image the user pasted into the composer, awaiting send. `data` is the
 * base64-encoded bytes with no `data:` URI prefix (mirrors `@core` MessageImage);
 * `id` and `name` are webview-only, for keying and labelling the chip.
 */
export interface WebviewImage {
  /** Stable id for keying and removing the chip. */
  id: string;
  /** MIME type, e.g. "image/png". */
  mediaType: string;
  /** Base64-encoded bytes, no `data:` URI prefix. */
  data: string;
}

/** An image carried on a transcript message, for rendering a thumbnail. */
export interface WebviewMessageImage {
  mediaType: string;
  data: string;
}

/**
 * A file the user attached to the composer (dropped or picked), sent with the
 * prompt as file context. `id` is webview-only, for keying the chip. Text
 * files carry their content verbatim; binary files carry base64 bytes — the
 * host materializes those to disk and hands the model the path, so any file
 * type can be attached and processed with tools.
 */
export interface WebviewFileAttachment {
  id: string;
  /** The file's name (no path — it came from outside the workspace view). */
  name: string;
  /** Text content, or base64 bytes when `encoding` is 'base64'. */
  content: string;
  /** How `content` is encoded; defaults to 'text'. */
  encoding?: FileEncoding;
  /** MIME type when known (binary files), e.g. "application/pdf". */
  mediaType?: string;
}

/** How a file attachment's `content` is encoded. */
export enum FileEncoding {
  Text = 'text',
  Base64 = 'base64',
}

/**
 * The provider → model a session last talked to, shown in the sessions list.
 * The provider's display name is resolved host-side (the webview has no
 * catalog access).
 */
export interface WebviewSessionModel {
  providerName: string;
  modelId: string;
}

/** A session summary for the sessions-list screen. */
export interface WebviewSessionSummary {
  sessionId: string;
  title?: string | undefined;
  updatedAt: string;
  messageCount: number;
  /** Whether the user pinned this session; pinned sessions list first. */
  pinned?: boolean | undefined;
  /** The provider → model the session last talked to, when it recorded one. */
  model?: WebviewSessionModel | undefined;
}

/** Reasoning/thinking intensity, mirrors `@core` ReasoningEffort enum values. */
export enum WebviewReasoningEffort {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  XHigh = 'xhigh',
  Max = 'max',
}

/** Explicit "reasoning off" choice, mirrors `@core` ReasoningDisabled. */
export enum WebviewReasoningDisabled {
  Off = 'off',
}

/** A reasoning choice the user can pick: an effort level, or explicit "off". */
export type WebviewReasoningChoice =
  | WebviewReasoningEffort
  | WebviewReasoningDisabled.Off;

/**
 * Reasoning capability advertised for a model, flattened from `@core`
 * ModelReasoning. Present only when the provider reports the model reasons.
 */
export interface WebviewModelReasoning {
  /** Effort levels the model accepts, in canonical low→high order. */
  effortLevels: WebviewReasoningEffort[];
  /** True when reasoning can't be turned off, so the picker omits "off". */
  mandatory: boolean;
  /** Provider default, applied when the user hasn't chosen a level. */
  defaultEffort?: WebviewReasoningEffort | undefined;
}

/** A model the user can pick, flattened from `@core` ModelInfo for the webview. */
export interface WebviewModel {
  id: string;
  displayName: string;
  providerId: string;
  providerName: string;
  contextWindow?: number | undefined;
  inputCostPerM?: number | undefined;
  outputCostPerM?: number | undefined;
  local?: boolean | undefined;
  /** Present only when the provider reports the model supports reasoning. */
  reasoning?: WebviewModelReasoning | undefined;
}

/** Auth methods a provider accepts; mirrors @core AuthMethod enum values. */
export enum AuthMethod {
  ApiKey = 'apiKey',
  OAuth = 'oauth',
}

/**
 * How a provider authenticates, used to label it in the settings list with a
 * short badge ("API Key", "Sign-in", "Local", "Custom").
 */
export enum WebviewProviderKind {
  ApiKey = 'apiKey',
  OAuth = 'oauth',
  Local = 'local',
  Custom = 'custom',
  /** Uses the user's own Claude Code login via the Agent SDK — no credentials. */
  Subscription = 'subscription',
}

/** A provider shown in the settings list, flattened from the catalog + config. */
export interface WebviewProvider {
  id: string;
  name: string;
  /** One-line description from the provider catalog. */
  description: string;
  /** True when the user has saved credentials for this provider. */
  connected: boolean;
  /** Auth method, drives the badge shown next to the name. */
  kind: WebviewProviderKind;
  /** Whether an API key is required to connect (vs optional or not needed). */
  apiKeyRequired: boolean;
  /** Default base URL from the catalog; pre-fills the inline connect form. */
  defaultBaseUrl?: string | undefined;
  /** True for providers that run locally (Ollama, LM Studio). */
  local?: boolean | undefined;
  /** Auth methods accepted; determines whether inline connect is possible. */
  authMethods: AuthMethod[];
  /**
   * True for providers that need no credentials at all (Claude Code): the
   * connect wizard shows a single executable-path step instead of the
   * api-key/base-url steps.
   */
  directConnect?: boolean | undefined;
  /**
   * Prefill for the direct-connect executable-path input: the saved path if the
   * user set one, otherwise an auto-detected `claude` install. Blank when none
   * was found — the field then shows a placeholder and the SDK auto-resolves.
   */
  executablePath?: string | undefined;
  /**
   * Prefill for the direct-connect config-directory (account) input: the saved
   * `CLAUDE_CONFIG_DIR` if set, else blank (default `~/.claude`).
   */
  configDir?: string | undefined;
  /**
   * Auto-detected Claude config directories (`~/.claude`, `~/.claude-work`, …)
   * shown as pick-able account options in the direct-connect form.
   */
  configDirOptions?: string[] | undefined;
}

/**
 * A file the user kept or undid in the changes panel, persisted per session so
 * reopening a chat doesn't resurface already-reviewed edits. Mirrors the
 * webview's `ResolvedFile`.
 */
export interface WebviewResolvedFile {
  /** Edit count at which it was resolved; a later edit unhides the file. */
  editCount: number;
  /** On-disk content the resolution left behind, used as the next baseline. */
  baseline: string;
}

/** Before/after text for a file a tool is about to change. */
export interface WebviewDiff {
  path: string;
  oldText: string;
  newText: string;
}

/** A human-readable view of a tool call, mirrors `@core` ToolInvocationView. */
export interface WebviewToolView {
  title: string;
  preview?: string;
  diff?: WebviewDiff;
  /** Workspace-relative path of the file the call concerns, when single-file. */
  path?: string;
  /**
   * True when the call was rejected or failed, so its `diff` is only a preview
   * of what would have happened — never applied to disk. The changes panel uses
   * this to exclude it from the aggregate of real, applied edits.
   */
  isError?: boolean;
}

/** A single transcript entry sent to the webview to render history. */
export interface WebviewMessage {
  id: string;
  role: WebviewRole;
  content: string;
  /** ISO timestamp of when the message was created (user: when it was sent). */
  createdAt?: string;
  /**
   * When the LLM received the request: set on user messages once dispatched,
   * and on assistant messages for the request that produced the reply.
   */
  llmReceivedAt?: string;
  /** Present on tool messages, names the tool that produced the result. */
  toolName?: string;
  /** Present on tool messages when we can reconstruct the original call view. */
  toolView?: WebviewToolView;
  /** Persisted assistant reasoning/thinking, when the provider streamed it. */
  thinking?: {
    content: string;
    durationMs: number;
  };
  /** Images attached to a user message, rendered as thumbnails. */
  images?: WebviewMessageImage[];
  /** Names of files attached to a user message, rendered as chips above it. */
  attachments?: string[];
  /**
   * True on the user message that opens a post-compaction epoch (it carries the
   * summary of compacted-away history); the transcript draws a divider on it.
   */
  isCompactSummary?: boolean;
}

export interface WebviewUsage {
  /** Cumulative input tokens across the session (the "in" readout). */
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  /**
   * Input tokens of the most recent request — the size of the context the
   * model currently sees. Drives the "ctx" readout and the context gauge.
   */
  lastInputTokens?: number;
  cost?: number;
}

/**
 * A provider whose model list couldn't be fetched (e.g. an unreachable local
 * server). Surfaced in the model picker so one failing provider never blocks the
 * panel — the user can still see why it's missing and switch to a working one.
 */
export interface WebviewProviderError {
  providerId: string;
  providerName: string;
  message: string;
}

/** Per-session timing stats mirroring the CLI's TTFT / tok-s footer. */
export interface WebviewStats {
  /** Time to first token for the most recent turn, in milliseconds. */
  ttftMs: number;
  /** Generation rate of the most recent turn, in tokens per second. */
  tokensPerSecond: number;
  /** Mean tok/s across every completed turn this session. */
  avgTokensPerSecond: number;
}

/** A toggleable tool, for the manage-tools popup. State lives in `disabledTools`. */
export interface WebviewTool {
  name: string;
  label: string;
  category: string;
  /** A short, one-line gist of what the tool does (shown on hover). */
  summary: string;
}

/**
 * A slash command contributed by an installed skill, for the composer's `/`
 * completions. `name` is the invocable form — the bare command name while
 * unique, or `skill:command` when the name is contested. Execution happens
 * host-side: the webview submits the typed text and the host resolves it.
 */
export interface WebviewSkillCommand {
  name: string;
  skillName: string;
  description?: string | undefined;
  /** Short usage hint, e.g. "<resume> [job-description]". */
  argumentHint?: string | undefined;
}

/** A chat mode for the mode picker. The active one is `activeModeId`. */
/** Semantic icon key for a chat mode; mirrors @core ModeIcon (kept local so the
 * dependency-free webview protocol needn't import host code). */
export enum WebviewModeIcon {
  Build = 'build',
  Ask = 'ask',
  Plan = 'plan',
  Custom = 'custom',
}

export interface WebviewMode {
  id: string;
  name: string;
  /** Semantic icon key; the webview maps it to an SVG (mirrors @core ModeIcon). */
  icon: WebviewModeIcon;
  /** Whether the user created this mode (vs. a built-in Build/Ask/Plan). */
  custom: boolean;
}

// --- Host -> Webview -------------------------------------------------------

/** Full snapshot of session state; sent on init and after a session reset. */
export interface ReadyMessage {
  type: HostMessageType.Ready;
  /** The session this snapshot is for; lets the webview tell a same-session
   * mid-turn resume (preserve live tool/stream state) from a fresh open. */
  sessionId: string;
  providerId: string | undefined;
  activeModel: string | undefined;
  models: WebviewModel[];
  messages: WebviewMessage[];
  /** Human-readable reason the session can't chat yet (e.g. no provider). */
  notice?: string;
  /** Providers whose model list couldn't be fetched, shown in the picker. */
  providerErrors?: WebviewProviderError[];
  autoApprove: boolean;
  expandTools: boolean;
  maxReadLines: number;
  /** Recent context window items sent to the model per request; 0 means "off" (send all). */
  maxHistoryMessages: number;
  /** Auto-compact when ctx usage reaches this percent of the window; 0 = off. */
  autoCompactThresholdPercent: number;
  /** When true, thinking blocks start collapsed so the user has to click to expand. */
  thinkingCollapsed: boolean;
  /**
   * When true (default), local providers refetch their model list on every load;
   * when false they use the same once-a-day cache as remote providers.
   */
  localModelAutoRefresh: boolean;
  /**
   * When true (default), cached model lists auto-refresh once a day. When
   * false the cache is served indefinitely; only "Refresh models" refetches.
   */
  modelAutoRefresh: boolean;
  /**
   * Whether the `lazy_load_tools` gateway is on (default true). When false, the
   * full tool set is advertised to the model from the first turn.
   */
  lazyToolLoading: boolean;
  /** The catalog of toggleable tools, grouped by category, for the manage-tools UI. */
  manageableTools: WebviewTool[];
  /** Names of tools the user has turned off; empty means all enabled. */
  disabledTools: string[];
  /**
   * Whether MCP servers are still connecting in the background. While true the
   * UI shows a "loading MCP servers" spinner; an McpStatus message clears it and
   * delivers the MCP tools once they're ready.
   */
  mcpLoading: boolean;
  /** The available chat modes (built-in + custom), for the mode picker. */
  modes: WebviewMode[];
  /** Id of the active chat mode. */
  activeModeId: string;
  /** Per-mode/per-sub-agent default models, for the pickers. */
  modelDefaults: WebviewModelDefaults;
  /**
   * Slash commands from installed skills, for the composer's `/` completions.
   * Absent/empty when no skills are installed.
   */
  skillCommands?: WebviewSkillCommand[];
  /**
   * The user's chosen reasoning effort per model, nested by provider id, e.g.
   * `{ openrouter: { "openai/gpt-5": "high" } }`. A model absent from the map
   * uses its default effort; the sentinel `'off'` disables reasoning for a model
   * that would otherwise default to it.
   */
  reasoningEffortByModel: Record<
    string,
    Record<string, WebviewReasoningChoice | undefined> | undefined
  >;
  /**
   * Files the user already kept/undid in this session's changes panel, restored
   * so resuming a chat doesn't resurface reviewed edits. Keyed by workspace path.
   */
  resolvedFiles: Record<string, WebviewResolvedFile>;
  /**
   * The conversation's persisted sub agent runs, so reopening a session keeps
   * them reviewable (via the robot popup and the transcript modal).
   */
  subAgents?: WebviewSubAgentRunSnapshot[];
  sessionTitle?: string | undefined;
  /** Absolute path of the workspace folder backing this session. */
  workspaceRoot: string;
  /** Restored cumulative token usage for a resumed session's footer. */
  usage?: WebviewUsage;
  /** Restored timing stats (TTFT / tok/s) for a resumed session's footer. */
  stats?: WebviewStats;
  /**
   * True when this session has a turn still running in the host (the user
   * reopened it mid-turn). The composer shows its busy/stop state; the recorded
   * live-turn events are replayed right after to rebuild the in-flight response.
   */
  busy?: boolean;
  /**
   * Epoch ms when the in-flight turn started, sent on a mid-turn resume so the
   * live tok/s estimate keeps its original time base instead of restarting the
   * clock (which would divide the whole replayed buffer by a near-zero elapsed
   * and spike the rate).
   */
  turnStartedAt?: number;
  /** Epoch ms of the in-flight turn's first token, for the same resume estimate. */
  turnFirstTokenAt?: number;
}

/** The sessions-list screen; sent on init or when the user navigates back. */
export interface SessionsListMessage {
  type: HostMessageType.SessionsList;
  sessions: WebviewSessionSummary[];
  /** True when at least one provider has credentials saved. */
  hasConnectedProvider: boolean;
  /**
   * When true (default), switch the webview to the sessions view. When false,
   * only refresh the session data in place — used after a provider change so
   * an in-progress chat isn't yanked back to the sessions list.
   */
  focus?: boolean;
  /**
   * The sessions whose turns are currently running, if any. Turns keep running
   * in the host after the user navigates back here (one per session, and they
   * run concurrently), so the list marks each of these as loading.
   */
  activeSessionIds?: string[];
}

/** The session title was generated; updates the chat header live. */
export interface TitleUpdateMessage {
  type: HostMessageType.TitleUpdate;
  title: string;
}

/** A streamed chunk of the assistant's visible reply for the current turn. */
export interface TokenMessage {
  type: HostMessageType.Token;
  token: string;
}

/** A streamed chunk of the assistant's reasoning/thinking for the current turn. */
export interface ThinkingMessage {
  type: HostMessageType.Thinking;
  token: string;
}

/** Start or end of a tool invocation, so the UI can show live tool activity. */
/** Mirrors `@core`'s `SubAgentActivityPhase` (kept dependency-free here). */
export enum WebviewSubAgentPhase {
  Start = 'start',
  Progress = 'progress',
  End = 'end',
}

/** Mirrors `@core`'s `SubAgentRunStatus` (kept dependency-free here). */
export enum WebviewSubAgentStatus {
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
  Aborted = 'aborted',
}

/**
 * Live progress of a sub agent run, mirrored from the engine's
 * `SubAgentActivityEvent` so the webview can render what each sub agent is
 * doing while it works (and its report when it finishes).
 */
/** Token usage a sub agent run billed to the account (mirrors TokenUsage). */
export interface WebviewSubAgentUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cost?: number;
}

/** A sub agent run's own throughput metrics (mirrors SubAgentRunStats). */
export interface WebviewSubAgentStats {
  lastInputTokens: number;
  ttftMs?: number;
  tokensPerSecond?: number;
  avgTokensPerSecond?: number;
}

export interface SubAgentActivityMessage {
  type: HostMessageType.SubAgentActivity;
  phase: WebviewSubAgentPhase;
  runId: string;
  /** The sub agent type's raw id (e.g. "explorer", "general"). */
  agentType: string;
  description: string;
  latestActivity?: string;
  toolUseCount?: number;
  status?: WebviewSubAgentStatus;
  summary?: string;
  /** The model id the run executes on (its default, or the fallback). */
  model?: string;
  /** The provider id backing {@link model}, for showing "provider · model". */
  providerId?: string;
  /** The run's cumulative usage; set on `end` events. */
  usage?: WebviewSubAgentUsage;
  /** The run's throughput metrics; set on `end` events. */
  stats?: WebviewSubAgentStats;
}

/**
 * A persisted sub agent run summarized for the webview, sent on Ready so a
 * reopened conversation still lists its sub agents (the robot popup) and can
 * open each run's transcript.
 */
export interface WebviewSubAgentRunSnapshot {
  runId: string;
  agentType: string;
  description: string;
  status: WebviewSubAgentStatus;
  toolUseCount: number;
  summary?: string;
  /** The model id the run executed on (its default, or the fallback). */
  model?: string;
  /** The provider id backing {@link model}. */
  providerId?: string;
  /** Epoch ms, matching the live SubAgentRunView timestamps. */
  startedAt: number;
  endedAt?: number;
  /** The run's cumulative usage, for the transcript footer. */
  usage?: WebviewSubAgentUsage;
  /** The run's throughput metrics, for the transcript footer. */
  stats?: WebviewSubAgentStats;
}

/**
 * The full transcript of one sub agent run, sent in response to
 * `RequestSubAgentTranscript`. `messages` reuses the main transcript's shape
 * so the webview renders it with the same components; for a still-running sub
 * agent the webview re-requests it on each activity event to stay live.
 */
export interface SubAgentTranscriptMessage {
  type: HostMessageType.SubAgentTranscript;
  runId: string;
  messages: WebviewMessage[];
}

export interface ToolActivityMessage {
  type: HostMessageType.ToolActivity;
  phase: ToolPhase;
  toolName: string;
  toolCallId: string;
  view: WebviewToolView;
  /** Present on `end`: whether the tool errored and a short result preview. */
  isError?: boolean;
  resultPreview?: string;
}

/** Asks the user to approve a tool that requires approval before it runs. */
export interface ApprovalRequestMessage {
  type: HostMessageType.ApprovalRequest;
  id: string;
  toolName: string;
  view: WebviewToolView;
}

/** A mid-turn question from a tool (e.g. the question tool) needing free text. */
export interface UserInputRequestMessage {
  type: HostMessageType.UserInputRequest;
  id: string;
  question: string;
  options?: string[];
}

/**
 * Live token-usage snapshot pushed mid-turn (after each model response) so the
 * footer metrics track an in-flight turn instead of jumping only at completion.
 */
export interface UsageUpdateMessage {
  type: HostMessageType.UsageUpdate;
  /** Cumulative token usage across every turn in the session so far. */
  usage: WebviewUsage;
}

/** The current turn finished; carries the authoritative message list + usage. */
export interface TurnCompleteMessage {
  type: HostMessageType.TurnComplete;
  messages: WebviewMessage[];
  /** Cumulative token usage across every turn in the session so far. */
  usage?: WebviewUsage;
  /** Timing stats for the footer; absent if no tokens streamed this turn. */
  stats?: WebviewStats;
}

/** A turn failed (or was aborted); the webview surfaces this and re-enables input. */
export interface ErrorMessage {
  type: HostMessageType.Error;
  message: string;
  /** True when the failure was a user-initiated cancel rather than a fault. */
  aborted?: boolean;
}

/**
 * The full, merged model list across all configured providers. Sent shortly
 * after {@link ReadyMessage}, which only carries the active provider's models so
 * the panel can render without waiting on slow/unreachable providers.
 */
export interface ModelsUpdateMessage {
  type: HostMessageType.ModelsUpdate;
  models: WebviewModel[];
  /** Providers whose model list couldn't be fetched, shown in the picker. */
  providerErrors: WebviewProviderError[];
  /** The now-active model id, when this update also switched it (e.g. a mode default). */
  activeModel?: string;
  /** The provider backing {@link activeModel}, when it changed too. */
  activeProviderId?: string;
}

/**
 * Sent when MCP servers finish connecting in the background, after a
 * {@link ReadyMessage} reported `mcpLoading: true`. Carries the refreshed tool
 * catalog (built-ins + the now-loaded MCP tools) and clears the spinner.
 */
export interface McpStatusMessage {
  type: HostMessageType.McpStatus;
  /** Whether MCP is still loading. False once the background connect finishes. */
  loading: boolean;
  /** The full toggleable-tool catalog, including MCP tools once loaded. */
  manageableTools: WebviewTool[];
  /** Names of tools the user has turned off; empty means all enabled. */
  disabledTools: string[];
}

/**
 * Sent after the user selects or creates a chat mode, so the picker and the
 * composer pill update without a full {@link ReadyMessage} (which would reset
 * the transcript and stats).
 */
export interface ModeUpdateMessage {
  type: HostMessageType.ModeUpdate;
  modes: WebviewMode[];
  activeModeId: string;
}

/** What a default-model binding attaches to (mirrors `@core`'s ModelDefaultTarget). */
export enum WebviewModelDefaultTarget {
  Mode = 'mode',
  SubAgent = 'subAgent',
}

/** A concrete provider+model pointer (mirrors `@core`'s ModelReference). */
export interface WebviewModelReference {
  providerId: string;
  modelId: string;
}

/** Per-mode/per-sub-agent default models (mirrors `@core`'s ModelDefaults). */
export interface WebviewModelDefaults {
  byMode: Record<string, WebviewModelReference>;
  bySubAgent: Record<string, WebviewModelReference>;
}

/**
 * Sent when the per-mode/per-sub-agent default models change (bind/clear), so
 * the pickers reflect the bound model without a full reload.
 */
export interface ModelDefaultsUpdateMessage {
  type: HostMessageType.ModelDefaultsUpdate;
  modelDefaults: WebviewModelDefaults;
}

/**
 * Sent after the user adds/updates/removes a skill in Settings, so the
 * composer's `/` completions refresh without reloading the chat panel.
 */
export interface SkillCommandsUpdateMessage {
  type: HostMessageType.SkillCommandsUpdate;
  skillCommands: WebviewSkillCommand[];
}

/** A transient status line shown above the transcript (e.g. after "Edit plan"). */
export interface NoticeMessage {
  type: HostMessageType.Notice;
  notice: string;
  /**
   * When set, the webview clears the notice after this many milliseconds
   * (e.g. the "auto-compact is close" warning). Unset notices persist until
   * replaced or the next snapshot.
   */
  timeoutMs?: number;
  /**
   * When true, the notice is an in-progress state (e.g. `/usage` fetching): the
   * floating banner shows a spinner beside the text and stays up (no self-
   * dismiss) until the host replaces it with the result.
   */
  loading?: boolean;
}

/**
 * A compaction started (`running: true`) or finished. On success the refreshed
 * transcript rides a {@link TurnCompleteMessage} sent just before the final
 * status; on failure `error` carries the reason and the conversation is
 * unchanged.
 */
export interface CompactStatusMessage {
  type: HostMessageType.CompactStatus;
  running: boolean;
  /** Rough size of the summary streamed so far (chars/4), pushed periodically. */
  tokens?: number;
  error?: string;
}

/**
 * Result of a webview-requested file revert. `ok` is false when the file
 * couldn't be restored (e.g. it moved or permissions changed); the panel then
 * keeps the row and surfaces `message`.
 */
export interface FileRevertedMessage {
  type: HostMessageType.FileReverted;
  /** Workspace-relative path that was reverted, matching the request. */
  path: string;
  ok: boolean;
  message?: string;
}

/**
 * Tells the webview that queued follow-ups were folded into the running turn to
 * steer the model (the host appended `content` as a user message before the next
 * model call). The webview drops the listed pills and shows the message in the
 * transcript so the steering is visible immediately, not just at turn end.
 */
export interface SteeringConsumedMessage {
  type: HostMessageType.SteeringConsumed;
  /** Ids of the queued messages that were consumed, to remove from the queue. */
  ids: string[];
  /** The combined text that was folded into the turn. */
  content: string;
}

/**
 * The workspace's files, sent in response to {@link RequestWorkspaceFilesMessage}
 * so the composer can offer `@file` completions. The webview caches and filters
 * this list locally, mirroring the CLI.
 */
export interface WorkspaceFilesMessage {
  type: HostMessageType.WorkspaceFiles;
  /** Workspace-relative paths. */
  files: string[];
}

/**
 * The symbols (functions/methods/classes) declared in a file, sent in response
 * to {@link RequestFileSymbolsMessage} so the composer can offer `@path::method`
 * completions. Empty when the file can't be read or has no detectable symbols.
 */
export interface FileSymbolsMessage {
  type: HostMessageType.FileSymbols;
  /** Workspace-relative path the symbols belong to (echoes the request). */
  path: string;
  symbols: string[];
}

/**
 * The host read dropped file paths from disk (see
 * {@link AttachDroppedPathsMessage}); the webview stages them as attachment
 * chips exactly like files dropped as File objects.
 */
export interface DroppedFilesLoadedMessage {
  type: HostMessageType.DroppedFilesLoaded;
  files: Array<{
    name: string;
    /** MIME type when derivable from the extension (images especially). */
    mediaType?: string;
    /** The file's raw bytes, base64-encoded. */
    base64: string;
  }>;
  /** Paths that couldn't be read, surfaced so the drop isn't silently lost. */
  failed?: string[];
}

export type HostToWebview =
  | ReadyMessage
  | DroppedFilesLoadedMessage
  | ModelsUpdateMessage
  | McpStatusMessage
  | ModeUpdateMessage
  | ModelDefaultsUpdateMessage
  | SkillCommandsUpdateMessage
  | NoticeMessage
  | CompactStatusMessage
  | SessionsListMessage
  | TitleUpdateMessage
  | TokenMessage
  | ThinkingMessage
  | ToolActivityMessage
  | SubAgentActivityMessage
  | SubAgentTranscriptMessage
  | ApprovalRequestMessage
  | UserInputRequestMessage
  | UsageUpdateMessage
  | TurnCompleteMessage
  | FileRevertedMessage
  | SteeringConsumedMessage
  | WorkspaceFilesMessage
  | FileSymbolsMessage
  | ErrorMessage;

// --- Webview -> Host -------------------------------------------------------

/** Webview finished loading and is asking the host for the initial snapshot. */
export interface InitMessage {
  type: WebviewMessageType.Init;
}

/** The user submitted a prompt for the current session. */
export interface SubmitMessage {
  type: WebviewMessageType.Submit;
  content: string;
  /** Images pasted into the composer, sent alongside the prompt. */
  images?: WebviewImage[];
  /** Files attached to the composer (dropped or picked), sent as context. */
  files?: WebviewFileAttachment[];
}

/**
 * The user clicked retry on one of their messages: the host drops that message
 * and everything after it from the conversation, then re-submits the same
 * content (and images) as a fresh turn.
 */
export interface RetryMessage {
  type: WebviewMessageType.Retry;
  /** Id of the user message to re-send from. */
  messageId: string;
  /**
   * When set, the user edited the message before re-sending: this content (and
   * `images`) is submitted instead of the original message's. Absent on a plain
   * retry, which re-sends the original verbatim.
   */
  content?: string;
  /** Images accompanying an edited re-send; only read when `content` is set. */
  images?: WebviewImage[];
}

/** The user asked to abort the in-flight turn. */
export interface CancelMessage {
  type: WebviewMessageType.Cancel;
}

/** The user answered a pending tool-approval prompt. */
export interface ApprovalResponseMessage {
  type: WebviewMessageType.ApprovalResponse;
  id: string;
  approved: boolean;
}

/** The user answered a pending tool question. */
export interface UserInputResponseMessage {
  type: WebviewMessageType.UserInputResponse;
  id: string;
  value: string;
}

/** The user picked a different model for subsequent turns. */
export interface SelectModelMessage {
  type: WebviewMessageType.SelectModel;
  modelId: string;
  /** Provider the model belongs to; disambiguates ids shared across providers. */
  providerId: string;
}

/**
 * The user bound a default model to a mode or a sub agent. Switching to that
 * mode auto-selects the model; a sub agent runs on it (falling back on error).
 */
export interface SetDefaultModelMessage {
  type: WebviewMessageType.SetDefaultModel;
  target: WebviewModelDefaultTarget;
  /** The mode id or sub agent id the default is bound to. */
  id: string;
  modelId: string;
  providerId: string;
}

/** The user cleared a mode's or sub agent's default model. */
export interface ClearDefaultModelMessage {
  type: WebviewMessageType.ClearDefaultModel;
  target: WebviewModelDefaultTarget;
  id: string;
}

/** The user chose a reasoning effort for a model (or "off" to disable it). */
export interface SetReasoningEffortMessage {
  type: WebviewMessageType.SetReasoningEffort;
  modelId: string;
  /** Provider the model belongs to; the choice is stored per provider+model. */
  providerId: string;
  effort: WebviewReasoningChoice;
}

/** The user asked to re-fetch every provider's model list, bypassing the cache. */
export interface RefreshModelsMessage {
  type: WebviewMessageType.RefreshModels;
}

/** The user asked to open the raw chat.json for the current session in an editor. */
export interface ViewChatLogMessage {
  type: WebviewMessageType.ViewChatLog;
}

/** The user switched the active provider; the host re-lists its models. */
export interface SelectProviderMessage {
  type: WebviewMessageType.SelectProvider;
  providerId: string;
}

/** The user cleared the conversation and started fresh. */
export interface NewSessionMessage {
  type: WebviewMessageType.NewSession;
}

/** The user navigated back to the sessions list. */
export interface ListSessionsMessage {
  type: WebviewMessageType.ListSessions;
  /**
   * When false, only refresh the session data in place (e.g. for the header's
   * session-switcher popup) instead of switching to the sessions view.
   * Defaults to true (navigate).
   */
  focus?: boolean;
}

/** The user selected a session from the list. */
export interface OpenSessionMessage {
  type: WebviewMessageType.OpenSession;
  sessionId: string;
}

/** The user renamed a session; a blank title clears it back to the default. */
export interface RenameSessionMessage {
  type: WebviewMessageType.RenameSession;
  sessionId: string;
  title: string;
}

/** The user pinned or unpinned a session from one of the session lists. */
export interface PinSessionMessage {
  type: WebviewMessageType.PinSession;
  sessionId: string;
  pinned: boolean;
}

/** The user asked to delete a session; the host confirms before removing it. */
export interface DeleteSessionMessage {
  type: WebviewMessageType.DeleteSession;
  sessionId: string;
}

/** The user asked to delete every saved session; the host confirms first. */
export interface ClearSessionsMessage {
  type: WebviewMessageType.ClearSessions;
}

/** The user wants to connect a new provider (host opens terminal). */
export interface ConnectProviderMessage {
  type: WebviewMessageType.ConnectProvider;
}

/** A focusable tab in the Settings editor, shared across both webview protocols. */
export enum SettingsSection {
  Providers = 'providers',
  Mcp = 'mcp',
  Prompts = 'prompts',
  Skills = 'skills',
}

/** The user opened Settings; the host reveals the settings editor tab. */
export interface OpenSettingsMessage {
  type: WebviewMessageType.OpenSettings;
  /** Optional tab to focus on open (e.g. Providers from the connect CTA). */
  section?: SettingsSection;
}

/** The user toggled auto-approval for write tools. */
export interface ToggleAutoApproveMessage {
  type: WebviewMessageType.ToggleAutoApprove;
}

/** The user toggled inline tool detail expansion. */
export interface ToggleExpandToolsMessage {
  type: WebviewMessageType.ToggleExpandTools;
}

/** The user set a new per-read line cap. */
export interface SetReadLimitMessage {
  type: WebviewMessageType.SetReadLimit;
  lines: number;
}

/** The user set a new history cap; 0 means "off" (send the whole conversation). */
export interface SetHistoryLimitMessage {
  type: WebviewMessageType.SetHistoryLimit;
  count: number;
}

/** The user asked to compact the conversation now. */
export interface CompactSessionMessage {
  type: WebviewMessageType.CompactSession;
}

/** The user set a new auto-compact threshold percent; 0 turns it off. */
export interface SetAutoCompactThresholdMessage {
  type: WebviewMessageType.SetAutoCompactThreshold;
  percent: number;
}

/** The user toggled whether thinking blocks start collapsed. */
export interface ToggleThinkingCollapsedMessage {
  type: WebviewMessageType.ToggleThinkingCollapsed;
}

/** The user toggled whether local providers always refresh their model list. */
export interface ToggleLocalModelAutoRefreshMessage {
  type: WebviewMessageType.ToggleLocalModelAutoRefresh;
}

/** The user toggled the daily auto-refresh of cached model lists. */
export interface ToggleModelAutoRefreshMessage {
  type: WebviewMessageType.ToggleModelAutoRefresh;
}

/** The user toggled the `lazy_load_tools` gateway (off = all tools up front). */
export interface ToggleLazyToolLoadingMessage {
  type: WebviewMessageType.ToggleLazyToolLoading;
}

/** The user changed which tools are turned off in the manage-tools popup. */
export interface SetDisabledToolsMessage {
  type: WebviewMessageType.SetDisabledTools;
  /** The full set of disabled tool names after the change. */
  names: string[];
}

/** The user picked a chat mode from the mode popup. */
export interface SelectModeMessage {
  type: WebviewMessageType.SelectMode;
  modeId: string;
}

/** The user created a custom chat mode. The host assigns it an id and selects it. */
export interface CreateModeMessage {
  type: WebviewMessageType.CreateMode;
  name: string;
  /** Optional system prompt; when blank the mode uses the Build (agent) prompt. */
  systemPrompt?: string;
}

/**
 * The user deleted a custom chat mode. The host removes it from config and,
 * when it was active, switches to Build; a ModeUpdate reflects the new list.
 */
export interface DeleteModeMessage {
  type: WebviewMessageType.DeleteMode;
  modeId: string;
}

/**
 * Write the plan to a fresh markdown file (a non-colliding name in the workspace
 * root), open it for editing, and switch to Build mode so the user can refine
 * the plan and then send it back to start implementation.
 */
export interface EditPlanMessage {
  type: WebviewMessageType.EditPlan;
  content: string;
}

/**
 * The user asked to undo a file's session changes from the changes panel. The
 * host restores `oldText` (the pre-session baseline), or deletes the file when
 * it was created this session.
 */
export interface RevertFileMessage {
  type: WebviewMessageType.RevertFile;
  /** Workspace-relative path to revert. */
  path: string;
  /** Baseline content to restore; ignored when `created` is true. */
  oldText: string;
  /** True when the file was created this session, so reverting deletes it. */
  created: boolean;
}

/**
 * The user's changes-panel resolutions changed (kept/undid a file); persist the
 * full map for the current session so it survives a reload.
 */
export interface SaveResolvedFilesMessage {
  type: WebviewMessageType.SaveResolvedFiles;
  resolved: Record<string, WebviewResolvedFile>;
}

/** The user ctrl/cmd-clicked a changed file to open it in the editor. */
export interface OpenFileMessage {
  type: WebviewMessageType.OpenFile;
  /** Workspace-relative path to reveal. */
  path: string;
}

/**
 * The user clicked a changed file's name in the changes panel to open VSCode's
 * native side-by-side diff editor: `baseline` (pre-session content) on the left
 * against the current on-disk file on the right.
 */
export interface OpenDiffMessage {
  type: WebviewMessageType.OpenDiff;
  /** Workspace-relative path to diff. */
  path: string;
  /** Pre-session baseline content shown on the diff's left side. */
  baseline: string;
  /** True when the file was created this session, so the baseline is empty. */
  created: boolean;
}

/**
 * The user chose "Configure MCP servers" in the manage-tools popup. The host
 * seeds `mcp.json` in the cache directory if absent and opens it in the editor.
 */
export interface OpenMcpConfigMessage {
  type: WebviewMessageType.OpenMcpConfig;
}

/**
 * Mirrors the webview's current text follow-ups to the host so the running turn
 * can steer on them. Sent whenever the queue changes; the host keeps the latest
 * snapshot and folds it in at the next agent step. Only text-only entries are
 * steerable — image-bearing follow-ups stay queued and send after the turn.
 */
export interface SyncSteeringQueueMessage {
  type: WebviewMessageType.SyncSteeringQueue;
  messages: { id: string; content: string }[];
}

/**
 * Asks the host for the workspace file list, to drive `@file` completions. Sent
 * the first time the user opens an `@` mention; the result is cached webview-side.
 */
export interface RequestWorkspaceFilesMessage {
  type: WebviewMessageType.RequestWorkspaceFiles;
}

/** Asks the host for a sub agent run's full transcript (see {@link SubAgentTranscriptMessage}). */
export interface RequestSubAgentTranscriptMessage {
  type: WebviewMessageType.RequestSubAgentTranscript;
  runId: string;
}

/** Asks the host for a file's symbols, to drive `@path::method` completions. */
export interface RequestFileSymbolsMessage {
  type: WebviewMessageType.RequestFileSymbols;
  /** Workspace-relative path to read symbols from. */
  path: string;
}

/**
 * The user dropped files that arrived as paths (`text/uri-list` — a drag from
 * the VS Code explorer, or an OS drag the browser exposed as URIs). The
 * webview can't read arbitrary disk paths, so the host does and answers with
 * {@link DroppedFilesLoadedMessage}.
 */
export interface AttachDroppedPathsMessage {
  type: WebviewMessageType.AttachDroppedPaths;
  paths: string[];
}

export type WebviewToHost =
  | InitMessage
  | SubmitMessage
  | AttachDroppedPathsMessage
  | RetryMessage
  | CancelMessage
  | ApprovalResponseMessage
  | UserInputResponseMessage
  | SelectModelMessage
  | SetDefaultModelMessage
  | ClearDefaultModelMessage
  | SetReasoningEffortMessage
  | RefreshModelsMessage
  | ViewChatLogMessage
  | SelectProviderMessage
  | NewSessionMessage
  | ListSessionsMessage
  | OpenSessionMessage
  | RenameSessionMessage
  | PinSessionMessage
  | DeleteSessionMessage
  | ClearSessionsMessage
  | ConnectProviderMessage
  | OpenSettingsMessage
  | ToggleAutoApproveMessage
  | ToggleExpandToolsMessage
  | SetReadLimitMessage
  | SetHistoryLimitMessage
  | CompactSessionMessage
  | SetAutoCompactThresholdMessage
  | ToggleThinkingCollapsedMessage
  | ToggleLocalModelAutoRefreshMessage
  | ToggleModelAutoRefreshMessage
  | ToggleLazyToolLoadingMessage
  | SetDisabledToolsMessage
  | SelectModeMessage
  | CreateModeMessage
  | DeleteModeMessage
  | EditPlanMessage
  | RevertFileMessage
  | SaveResolvedFilesMessage
  | SyncSteeringQueueMessage
  | RequestWorkspaceFilesMessage
  | RequestSubAgentTranscriptMessage
  | RequestFileSymbolsMessage
  | OpenFileMessage
  | OpenDiffMessage
  | OpenMcpConfigMessage;
