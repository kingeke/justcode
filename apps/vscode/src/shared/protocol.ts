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
  ApprovalRequest = 'approvalRequest',
  UserInputRequest = 'userInputRequest',
  TurnComplete = 'turnComplete',
  ModelsUpdate = 'modelsUpdate',
  Error = 'error',
}

/** Discriminator for messages sent from the webview to the extension host. */
export enum WebviewMessageType {
  Init = 'init',
  Submit = 'submit',
  Cancel = 'cancel',
  ApprovalResponse = 'approvalResponse',
  UserInputResponse = 'userInputResponse',
  SelectModel = 'selectModel',
  SelectProvider = 'selectProvider',
  NewSession = 'newSession',
  ToggleAutoWrites = 'toggleAutoWrites',
  ToggleExpandTools = 'toggleExpandTools',
  SetReadLimit = 'setReadLimit',
  ListSessions = 'listSessions',
  OpenSession = 'openSession',
  DeleteSession = 'deleteSession',
  ClearSessions = 'clearSessions',
  ConnectProvider = 'connectProvider',
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

/** A session summary for the sessions-list screen. */
export interface WebviewSessionSummary {
  sessionId: string;
  title?: string | undefined;
  updatedAt: string;
  messageCount: number;
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
}

/** A provider the user can connect to, flattened for the webview. */
export interface WebviewProvider {
  id: string;
  name: string;
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
}

/** A single transcript entry sent to the webview to render history. */
export interface WebviewMessage {
  id: string;
  role: WebviewRole;
  content: string;
  /** Present on tool messages, names the tool that produced the result. */
  toolName?: string;
}

export interface WebviewUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cost?: number;
}

// --- Host -> Webview -------------------------------------------------------

/** Full snapshot of session state; sent on init and after a session reset. */
export interface ReadyMessage {
  type: HostMessageType.Ready;
  providerId: string | undefined;
  activeModel: string | undefined;
  models: WebviewModel[];
  providers: WebviewProvider[];
  messages: WebviewMessage[];
  /** Human-readable reason the session can't chat yet (e.g. no provider). */
  notice?: string;
  autoApplyWrites: boolean;
  expandTools: boolean;
  maxReadLines: number;
  sessionTitle?: string | undefined;
}

/** The sessions-list screen; sent on init or when the user navigates back. */
export interface SessionsListMessage {
  type: HostMessageType.SessionsList;
  sessions: WebviewSessionSummary[];
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

/** The current turn finished; carries the authoritative message list + usage. */
export interface TurnCompleteMessage {
  type: HostMessageType.TurnComplete;
  messages: WebviewMessage[];
  usage?: WebviewUsage;
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
}

export type HostToWebview =
  | ReadyMessage
  | ModelsUpdateMessage
  | SessionsListMessage
  | TitleUpdateMessage
  | TokenMessage
  | ThinkingMessage
  | ToolActivityMessage
  | ApprovalRequestMessage
  | UserInputRequestMessage
  | TurnCompleteMessage
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
}

/** The user selected a session from the list. */
export interface OpenSessionMessage {
  type: WebviewMessageType.OpenSession;
  sessionId: string;
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

/** The user toggled auto-approval for write tools. */
export interface ToggleAutoWritesMessage {
  type: WebviewMessageType.ToggleAutoWrites;
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

export type WebviewToHost =
  | InitMessage
  | SubmitMessage
  | CancelMessage
  | ApprovalResponseMessage
  | UserInputResponseMessage
  | SelectModelMessage
  | SelectProviderMessage
  | NewSessionMessage
  | ListSessionsMessage
  | OpenSessionMessage
  | DeleteSessionMessage
  | ClearSessionsMessage
  | ConnectProviderMessage
  | ToggleAutoWritesMessage
  | ToggleExpandToolsMessage
  | SetReadLimitMessage;
