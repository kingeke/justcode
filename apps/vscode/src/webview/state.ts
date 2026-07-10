import {
  HostMessageType,
  ToolPhase,
  WebviewRole,
  WebviewSubAgentPhase,
  WebviewSubAgentStatus,
  type ApprovalRequestMessage,
  type WebviewSubAgentStats,
  type WebviewSubAgentUsage,
  type HostToWebview,
  type UserInputRequestMessage,
  type WebviewFileAttachment,
  type WebviewImage,
  type WebviewMessage,
  type WebviewModel,
  type WebviewProviderError,
  type WebviewReasoningChoice,
  type WebviewSessionSummary,
  type WebviewTool,
  type WebviewToolView,
  type WebviewUsage,
  type WebviewStats,
  type WebviewMode,
  type WebviewModelDefaults,
  type WebviewSkillCommand,
} from '@ext/shared/protocol';
import type { ResolvedFile } from '@ext/webview/changes';

/** A tool invocation as the transcript tracks it across start/end events. */
export interface ToolActivity {
  toolCallId: string;
  toolName: string;
  view: WebviewToolView;
  done: boolean;
  isError: boolean;
  resultPreview?: string;
}

export enum LiveTurnItemKind {
  Thinking = 'thinking',
  Tool = 'tool',
  Message = 'message',
}

export interface LiveThinkingItem {
  kind: LiveTurnItemKind.Thinking;
  id: string;
  content: string;
  durationMs: number;
}

export interface LiveToolItem {
  kind: LiveTurnItemKind.Tool;
  id: string;
  toolCallId: string;
}

export interface LiveMessageItem {
  kind: LiveTurnItemKind.Message;
  id: string;
  content: string;
  /**
   * How the item renders; assistant when absent. User is used for the steering
   * echo — a queued message folded into the running turn — so it shows at its
   * actual position in the flow rather than above the turn's live output.
   */
  role?: WebviewRole;
}

export type LiveTurnItem = LiveThinkingItem | LiveToolItem | LiveMessageItem;

let nextLiveItemId = 0;

function createLiveItemId(): string {
  nextLiveItemId += 1;
  return `live-${nextLiveItemId}`;
}

export enum ChatStatus {
  Loading = 'loading',
  Ready = 'ready',
}

/**
 * A message the user submitted while a turn was in flight, held until the turn
 * finishes. Carries its own staged images so a screenshot queued mid-turn isn't
 * lost. Flushed (combined into one turn) once the agent is idle again.
 */
export interface QueuedMessage {
  id: string;
  content: string;
  images: WebviewImage[];
  /** File attachments staged with the queued message, if any. */
  files?: WebviewFileAttachment[];
}

export enum ChatView {
  Sessions = 'sessions',
  Chat = 'chat',
  ModelPicker = 'model-picker',
}

export interface ChatState {
  status: ChatStatus;
  view: ChatView;
  /**
   * When true, assistant responses (text, thinking, tool activity) are hidden so
   * only the user's own messages show — handy for scanning back through what you
   * asked without wading through long replies. A view-only preference: it lives
   * in webview state and isn't persisted.
   */
  collapseResponses: boolean;
  /**
   * When true, the ChatGPT-style conversation sidebar is shown on the right edge
   * of the chat view: a hover strip that expands into an outline of the user's
   * messages in the open conversation, each a truncated plain-text preview that
   * scrolls the transcript on click. A view-only preference the user toggles
   * from the chat header; defaults on.
   */
  showConversationSidebar: boolean;
  sessions: WebviewSessionSummary[];
  hasConnectedProvider: boolean;
  /** The session currently open in the chat view. */
  sessionId?: string | undefined;
  /** Sessions with a turn running in the host, shown as loading in the list. */
  activeSessionIds?: string[] | undefined;
  // The fields below are cleared back to `undefined` on session resets, so they
  // carry an explicit `| undefined` (required under exactOptionalPropertyTypes).
  providerId?: string | undefined;
  activeModel?: string | undefined;
  models: WebviewModel[];
  /** Providers whose model list couldn't be fetched, shown in the picker. */
  providerErrors: WebviewProviderError[];
  notice?: string | undefined;
  /** When set, the notice self-dismisses after this many ms (see App effect). */
  noticeTimeoutMs?: number | undefined;
  /** When true, the notice is a loading state — banner shows a spinner. */
  noticeLoading?: boolean | undefined;
  messages: WebviewMessage[];
  busy: boolean;
  thinking: string;
  /** Milliseconds the model spent thinking; 0 while thinking is in progress or unknown. */
  thinkingDurationMs: number;
  /** Timestamp (Date.now()) when the first thinking token arrived this turn. */
  thinkingStartedAt: number;
  streaming: string;
  /**
   * Epoch ms the current turn started, 0 when idle. Drives the live tok/s time
   * base; seeded from the host on a mid-turn resume so it survives reopening.
   */
  turnStartedAt: number;
  /** Epoch ms of the current turn's first token, 0 until one arrives. */
  turnFirstTokenAt: number;
  tools: ToolActivity[];
  /**
   * Live view of the sub agents spawned by this turn's `task` calls, upserted
   * from SubAgentActivity messages. Cleared when a new turn starts; finished
   * runs stay listed until then so their reports remain reviewable.
   */
  subAgents: SubAgentRunView[];
  /**
   * The conversation's persisted sub agent runs (from the Ready snapshot), so
   * a reopened session still lists them in the robot popup. Live runs from the
   * current turn live in `subAgents`; the popup merges the two.
   */
  sessionSubAgents: SubAgentRunView[];
  /**
   * Fetched sub agent transcripts by run id (see the SubAgentTranscript
   * message); populated on demand when the user opens a run's popup and
   * refreshed while the run is live. Cleared alongside `subAgents`.
   */
  subAgentTranscripts: Record<string, WebviewMessage[]>;
  approval?: ApprovalRequestMessage | undefined;
  input?: UserInputRequestMessage | undefined;
  usage?: WebviewUsage | undefined;
  stats?: WebviewStats | undefined;
  error?: string | undefined;
  /** Completed in-flight turn chunks, in the order they streamed. */
  liveTurnItems: LiveTurnItem[];
  /** Thinking segments from the just-completed turn, kept visible after commit. */
  completedThinkingItems: LiveThinkingItem[];
  autoApprove: boolean;
  expandTools: boolean;
  maxReadLines: number;
  /** Recent context window items sent to the model per request; 0 means "off" (send all). */
  maxHistoryMessages: number;
  /** Auto-compact when ctx usage reaches this percent of the window; 0 = off. */
  autoCompactThresholdPercent: number;
  /** True while the host is summarizing the conversation (compaction). */
  compacting: boolean;
  /** Rough size of the summary streamed so far during compaction (chars/4). */
  compactTokens?: number | undefined;
  /** When true, thinking blocks start collapsed (user must click to expand). */
  thinkingCollapsed: boolean;
  /** When true (default), local providers refetch their model list every load. */
  localModelAutoRefresh: boolean;
  /** When true (default), cached model lists auto-refresh once a day. */
  modelAutoRefresh: boolean;
  /** Whether lazy tool loading is on (off = send all tools up front). */
  lazyToolLoading: boolean;
  /** The catalog of toggleable tools, for the manage-tools popup. */
  manageableTools: WebviewTool[];
  /** Names of tools the user has turned off; empty means all enabled. */
  disabledTools: string[];
  /** Whether MCP servers are still connecting (shows a spinner in the tools UI). */
  mcpLoading: boolean;
  /** Available chat modes (built-in + custom), for the mode picker. */
  modes: WebviewMode[];
  /** Id of the active chat mode. */
  activeModeId: string;
  /** Per-mode/per-sub-agent default models, for the pickers. */
  modelDefaults: WebviewModelDefaults;
  /** Slash commands from installed skills, for the composer's `/` completions. */
  skillCommands: WebviewSkillCommand[];
  /**
   * The user's chosen reasoning effort per model, nested by provider id. A model
   * absent from the map uses its default effort; `'off'` disables reasoning.
   */
  reasoningEffortByModel: Record<
    string,
    Record<string, WebviewReasoningChoice | undefined> | undefined
  >;
  sessionTitle?: string | undefined;
  /**
   * Files the user has resolved in the changes panel (kept or undone), mapping
   * the path to where the resolution left off (edit count + baseline content).
   * A later edit pushes the count past this mark and the file reappears, diffed
   * against the recorded baseline. Reset per session.
   */
  resolvedFiles: Record<string, ResolvedFile>;
  /** Last file-revert failure, surfaced under the changes panel. */
  revertError?: string | undefined;
  /** Messages submitted mid-turn, sent once the active turn finishes. */
  queuedMessages: QueuedMessage[];
  /**
   * Workspace files for the composer's `@file` completions, fetched lazily from
   * the host the first time an `@` mention opens and filtered locally after.
   */
  workspaceFiles: string[];
  /** Absolute path of the workspace folder backing this session. */
  workspaceRoot: string;
  /** A file's symbols for `@path::method` completions, cached by path. */
  fileSymbols: Record<string, string[]>;
}

/** One sub agent run as the webview renders it (see SubAgentPanel). */
export interface SubAgentRunView {
  runId: string;
  agentType: string;
  description: string;
  toolUseCount: number;
  latestActivity?: string | undefined;
  status: WebviewSubAgentStatus;
  summary?: string | undefined;
  /** The model id the run executes on, and its provider, for "provider · model". */
  model?: string | undefined;
  providerId?: string | undefined;
  startedAt: number;
  endedAt?: number | undefined;
  /** The run's cumulative usage, for the transcript footer. */
  usage?: WebviewSubAgentUsage | undefined;
  /** The run's throughput metrics, for the transcript footer. */
  stats?: WebviewSubAgentStats | undefined;
}

export const initialState: ChatState = {
  status: ChatStatus.Loading,
  view: ChatView.Sessions,
  collapseResponses: false,
  showConversationSidebar: true,
  sessions: [],
  hasConnectedProvider: false,
  sessionId: undefined,
  activeSessionIds: undefined,
  models: [],
  providerErrors: [],
  messages: [],
  busy: false,
  thinking: '',
  thinkingDurationMs: 0,
  thinkingStartedAt: 0,
  streaming: '',
  turnStartedAt: 0,
  turnFirstTokenAt: 0,
  tools: [],
  subAgents: [],
  sessionSubAgents: [],
  subAgentTranscripts: {},
  liveTurnItems: [],
  completedThinkingItems: [],
  autoApprove: false,
  expandTools: false,
  maxReadLines: 200,
  maxHistoryMessages: 50,
  autoCompactThresholdPercent: 80,
  compacting: false,
  thinkingCollapsed: false,
  localModelAutoRefresh: true,
  modelAutoRefresh: true,
  lazyToolLoading: true,
  manageableTools: [],
  disabledTools: [],
  mcpLoading: false,
  modes: [],
  activeModeId: 'build',
  modelDefaults: { byMode: {}, bySubAgent: {} },
  skillCommands: [],
  reasoningEffortByModel: {},
  resolvedFiles: {},
  queuedMessages: [],
  workspaceFiles: [],
  workspaceRoot: '',
  fileSymbols: {},
};

/** Local-only actions, distinct from host messages, for optimistic UI updates. */
export enum LocalActionType {
  OptimisticSubmit = 'optimisticSubmit',
  OptimisticRetry = 'optimisticRetry',
  OptimisticEdit = 'optimisticEdit',
  DismissApproval = 'dismissApproval',
  DismissInput = 'dismissInput',
  SelectModel = 'selectModel',
  SetReasoningEffort = 'setReasoningEffort',
  ToggleAutoApprove = 'toggleAutoApprove',
  ToggleExpandTools = 'toggleExpandTools',
  ToggleThinkingCollapsed = 'toggleThinkingCollapsed',
  ToggleLocalModelAutoRefresh = 'toggleLocalModelAutoRefresh',
  ToggleModelAutoRefresh = 'toggleModelAutoRefresh',
  ToggleLazyToolLoading = 'toggleLazyToolLoading',
  SetDisabledTools = 'setDisabledTools',
  SetReadLimit = 'setReadLimit',
  SetHistoryLimit = 'setHistoryLimit',
  SetAutoCompactThreshold = 'setAutoCompactThreshold',
  SetView = 'setView',
  ToggleCollapseResponses = 'toggleCollapseResponses',
  ToggleConversationSidebar = 'toggleConversationSidebar',
  SetTitle = 'setTitle',
  QueueMessage = 'queueMessage',
  DequeueMessage = 'dequeueMessage',
  UpdateQueuedMessage = 'updateQueuedMessage',
  ClearQueue = 'clearQueue',
  ResolveFiles = 'resolveFiles',
  UnresolveFile = 'unresolveFile',
}

export type LocalAction =
  | {
      type: LocalActionType.OptimisticSubmit;
      content: string;
      images: WebviewImage[];
      /** Names of attached files, echoed as chips on the optimistic message. */
      attachmentNames?: string[];
    }
  | { type: LocalActionType.OptimisticRetry; messageId: string }
  | {
      type: LocalActionType.OptimisticEdit;
      messageId: string;
      content: string;
      images: WebviewImage[];
    }
  | { type: LocalActionType.DismissApproval }
  | { type: LocalActionType.DismissInput }
  | { type: LocalActionType.SelectModel; modelId: string; providerId: string }
  | {
      type: LocalActionType.SetReasoningEffort;
      modelId: string;
      providerId: string;
      effort: WebviewReasoningChoice;
    }
  | { type: LocalActionType.ToggleAutoApprove }
  | { type: LocalActionType.ToggleExpandTools }
  | { type: LocalActionType.ToggleThinkingCollapsed }
  | { type: LocalActionType.ToggleLocalModelAutoRefresh }
  | { type: LocalActionType.ToggleModelAutoRefresh }
  | { type: LocalActionType.ToggleLazyToolLoading }
  | { type: LocalActionType.SetDisabledTools; names: string[] }
  | { type: LocalActionType.SetReadLimit; lines: number }
  | { type: LocalActionType.SetHistoryLimit; count: number }
  | { type: LocalActionType.SetAutoCompactThreshold; percent: number }
  | { type: LocalActionType.SetView; view: ChatView }
  | { type: LocalActionType.ToggleCollapseResponses }
  | { type: LocalActionType.ToggleConversationSidebar }
  | { type: LocalActionType.SetTitle; title: string }
  | {
      type: LocalActionType.QueueMessage;
      content: string;
      images: WebviewImage[];
      files?: WebviewFileAttachment[];
    }
  | { type: LocalActionType.DequeueMessage; id: string }
  | { type: LocalActionType.UpdateQueuedMessage; id: string; content: string }
  | { type: LocalActionType.ClearQueue }
  | {
      type: LocalActionType.ResolveFiles;
      files: Array<{ path: string; resolution: ResolvedFile }>;
    }
  | { type: LocalActionType.UnresolveFile; path: string };

export type Action = HostToWebview | LocalAction;

/**
 * Folds host messages and local UI actions into the rendered chat state. The
 * authoritative message list always comes from the host on `ready`/`turnComplete`;
 * the streaming/thinking/tools fields are transient scratch space for the
 * in-flight turn and get cleared whenever the host hands us a fresh snapshot.
 */
/**
 * Folds the previous turn's live sub agent runs into the session's persisted
 * list before a new turn clears the live state. Without this, finished runs
 * vanish from the floating robot button the moment a new message is sent, and
 * only reappear once a Ready snapshot reloads them from disk.
 */
function retireLiveSubAgents(state: ChatState): SubAgentRunView[] {
  if (state.subAgents.length === 0) return state.sessionSubAgents;
  const liveIds = new Set(state.subAgents.map((run) => run.runId));
  return [
    ...state.sessionSubAgents.filter((run) => !liveIds.has(run.runId)),
    ...state.subAgents,
  ];
}

export function reducer(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    case HostMessageType.Ready:
      return {
        ...state,
        status: ChatStatus.Ready,
        view: ChatView.Chat,
        sessionId: action.sessionId,
        providerId: action.providerId,
        activeModel: action.activeModel,
        models: action.models,
        providerErrors: action.providerErrors ?? [],
        messages: action.messages,
        notice: action.notice,
        // Reset the transient live-turn state. When resuming a still-running
        // session (busy), the host replays the recorded turn events right after
        // this Ready, rebuilding the thinking/tools/answer through the reducer.
        busy: action.busy ?? false,
        thinking: '',
        thinkingDurationMs: 0,
        thinkingStartedAt: 0,
        streaming: '',
        // Seed the live tok/s clock from the host's real timings on resume, so
        // it keeps its original time base instead of restarting from ~0 elapsed.
        turnStartedAt: action.busy ? (action.turnStartedAt ?? Date.now()) : 0,
        turnFirstTokenAt: action.busy ? (action.turnFirstTokenAt ?? 0) : 0,
        tools: [],
        subAgents: [],
        // The conversation's persisted runs, so reopening a session keeps its
        // sub agents reviewable through the robot popup.
        sessionSubAgents: (action.subAgents ?? []).map((run) => ({
          runId: run.runId,
          agentType: run.agentType,
          description: run.description,
          toolUseCount: run.toolUseCount,
          status: run.status,
          summary: run.summary,
          model: run.model,
          providerId: run.providerId,
          startedAt: run.startedAt,
          endedAt: run.endedAt,
          usage: run.usage,
          stats: run.stats,
        })),
        subAgentTranscripts: {},
        liveTurnItems: [],
        completedThinkingItems: [],
        approval: undefined,
        input: undefined,
        error: undefined,
        // View-only toggle: every session snapshot starts with responses visible
        // so a collapse from a previous session doesn't hide the new one.
        collapseResponses: false,
        // A resumed session carries its persisted footer metrics; a fresh one
        // resets them.
        usage: action.usage,
        stats: action.stats,
        autoApprove: action.autoApprove,
        expandTools: action.expandTools,
        maxReadLines: action.maxReadLines,
        maxHistoryMessages: action.maxHistoryMessages,
        autoCompactThresholdPercent: action.autoCompactThresholdPercent,
        compacting: false,
        thinkingCollapsed: action.thinkingCollapsed,
        localModelAutoRefresh: action.localModelAutoRefresh,
        modelAutoRefresh: action.modelAutoRefresh,
        lazyToolLoading: action.lazyToolLoading,
        manageableTools: action.manageableTools,
        disabledTools: action.disabledTools,
        mcpLoading: action.mcpLoading,
        modes: action.modes,
        activeModeId: action.activeModeId,
        modelDefaults: action.modelDefaults,
        skillCommands: action.skillCommands ?? [],
        reasoningEffortByModel: action.reasoningEffortByModel,
        sessionTitle: action.sessionTitle,
        workspaceRoot: action.workspaceRoot,
        // Restore the resolutions saved for this session so a resumed chat keeps
        // already-kept/undone files dismissed instead of resurfacing them.
        resolvedFiles: action.resolvedFiles,
        revertError: undefined,
        // A new session/snapshot drops anything that was queued.
        queuedMessages: [],
      };

    case HostMessageType.McpStatus:
      return {
        ...state,
        mcpLoading: action.loading,
        manageableTools: action.manageableTools,
        disabledTools: action.disabledTools,
      };

    case HostMessageType.SkillCommandsUpdate:
      return { ...state, skillCommands: action.skillCommands };

    case HostMessageType.ModeUpdate:
      return {
        ...state,
        modes: action.modes,
        activeModeId: action.activeModeId,
      };

    case HostMessageType.ModelDefaultsUpdate:
      return { ...state, modelDefaults: action.modelDefaults };

    case HostMessageType.Notice:
      return {
        ...state,
        notice: action.notice,
        noticeTimeoutMs: action.timeoutMs,
        noticeLoading: action.loading,
      };

    case HostMessageType.CompactStatus:
      return {
        ...state,
        compacting: action.running,
        compactTokens: action.running ? action.tokens : undefined,
        ...(action.error ? { error: action.error } : {}),
      };

    case HostMessageType.ModelsUpdate: {
      // The initial load shows a "some providers could not be reached" banner
      // when the active provider's first `listModels` fails — often just a cold
      // start (e.g. Claude Code spawning its runtime). The background refresh
      // then re-lists every provider; when that comes back clean, the banner is
      // stale, so clear it once the errors go away.
      const clearedStaleBanner =
        state.providerErrors.length > 0 && action.providerErrors.length === 0;
      return {
        ...state,
        models: action.models,
        providerErrors: action.providerErrors,
        ...(clearedStaleBanner ? { notice: undefined } : {}),
        // A mode's default model switch rides a ModelsUpdate carrying the new
        // active model/provider so the composer pill updates without a reload.
        ...(action.activeModel ? { activeModel: action.activeModel } : {}),
        ...(action.activeProviderId
          ? { providerId: action.activeProviderId }
          : {}),
      };
    }

    case HostMessageType.SteeringConsumed: {
      // The host folded these queued follow-ups into the running turn. Drop their
      // pills and surface the combined message in the transcript now, so the
      // steering is visible immediately rather than only at turn end (the
      // authoritative rebuild on TurnComplete replaces this echo). It must land
      // *inside* the live turn — appending to `messages` would render it above
      // everything the turn has produced so far. Flush the in-flight thinking
      // and prose first so the echo sits after them, mirroring where the
      // service actually inserts it (after the previous round-trip's output).
      const consumed = new Set(action.ids);
      const flushed = flushStreaming(flushThinking(state));
      return {
        ...flushed,
        queuedMessages: state.queuedMessages.filter((m) => !consumed.has(m.id)),
        liveTurnItems: [
          ...flushed.liveTurnItems,
          {
            kind: LiveTurnItemKind.Message,
            id: createLiveItemId(),
            role: WebviewRole.User,
            content: action.content,
          },
        ],
      };
    }

    case HostMessageType.SessionsList:
      // A non-focusing refresh (e.g. after connecting a provider mid-chat) just
      // updates the session data without pulling the user out of their view.
      if (action.focus === false) {
        return {
          ...state,
          sessions: action.sessions,
          hasConnectedProvider: action.hasConnectedProvider,
          activeSessionIds: action.activeSessionIds,
        };
      }
      return {
        ...state,
        status: ChatStatus.Ready,
        view: ChatView.Sessions,
        sessions: action.sessions,
        hasConnectedProvider: action.hasConnectedProvider,
        activeSessionIds: action.activeSessionIds,
        busy: false,
        approval: undefined,
        input: undefined,
        error: undefined,
      };

    case LocalActionType.OptimisticSubmit:
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: `local-${Date.now()}`,
            role: WebviewRole.User,
            content: action.content,
            // Sent time shows immediately; the authoritative rebuild at turn
            // end replaces this echo with the persisted timestamps (including
            // when the LLM received it).
            createdAt: new Date().toISOString(),
            ...(action.images.length
              ? {
                  images: action.images.map((image) => ({
                    mediaType: image.mediaType,
                    data: image.data,
                  })),
                }
              : {}),
            ...(action.attachmentNames?.length
              ? { attachments: action.attachmentNames }
              : {}),
          },
        ],
        busy: true,
        thinking: '',
        thinkingDurationMs: 0,
        thinkingStartedAt: 0,
        streaming: '',
        turnStartedAt: Date.now(),
        turnFirstTokenAt: 0,
        tools: [],
        // The previous turn's finished runs retire to the session list so the
        // floating robot button keeps them reviewable across turns.
        sessionSubAgents: retireLiveSubAgents(state),
        subAgents: [],
        subAgentTranscripts: {},
        liveTurnItems: [],
        completedThinkingItems: [],
        error: undefined,
      };

    // Retrying a user message scraps everything after it; the retried message
    // itself stays visible as the optimistic echo of the re-submit (the
    // authoritative rebuild at turn end replaces it with the fresh copy).
    case LocalActionType.OptimisticRetry: {
      const index = state.messages.findIndex((m) => m.id === action.messageId);
      if (index === -1) return state;
      return {
        ...state,
        messages: state.messages.slice(0, index + 1),
        busy: true,
        thinking: '',
        thinkingDurationMs: 0,
        thinkingStartedAt: 0,
        streaming: '',
        turnStartedAt: Date.now(),
        turnFirstTokenAt: 0,
        tools: [],
        sessionSubAgents: retireLiveSubAgents(state),
        subAgents: [],
        subAgentTranscripts: {},
        liveTurnItems: [],
        completedThinkingItems: [],
        error: undefined,
      };
    }

    // Editing-and-resending a user message scraps it and everything after it;
    // the edited replacement shows as a fresh optimistic echo in its place.
    case LocalActionType.OptimisticEdit: {
      const index = state.messages.findIndex((m) => m.id === action.messageId);
      if (index === -1) return state;
      return {
        ...state,
        messages: [
          ...state.messages.slice(0, index),
          {
            id: `local-${Date.now()}`,
            role: WebviewRole.User,
            content: action.content,
            createdAt: new Date().toISOString(),
            ...(action.images.length
              ? {
                  images: action.images.map((image) => ({
                    mediaType: image.mediaType,
                    data: image.data,
                  })),
                }
              : {}),
          },
        ],
        busy: true,
        thinking: '',
        thinkingDurationMs: 0,
        thinkingStartedAt: 0,
        streaming: '',
        turnStartedAt: Date.now(),
        turnFirstTokenAt: 0,
        tools: [],
        sessionSubAgents: retireLiveSubAgents(state),
        subAgents: [],
        subAgentTranscripts: {},
        liveTurnItems: [],
        completedThinkingItems: [],
        error: undefined,
      };
    }

    case HostMessageType.Token: {
      // First answer token after thinking: commit that thinking segment inline so
      // it settles above the streaming answer instead of growing in one block.
      const nextState = flushThinking(state);
      return {
        ...nextState,
        streaming: nextState.streaming + action.token,
        turnFirstTokenAt:
          nextState.turnFirstTokenAt === 0
            ? Date.now()
            : nextState.turnFirstTokenAt,
      };
    }

    case HostMessageType.Thinking:
      return {
        ...state,
        thinking: state.thinking + action.token,
        thinkingStartedAt:
          state.thinkingStartedAt === 0 ? Date.now() : state.thinkingStartedAt,
        turnFirstTokenAt:
          state.turnFirstTokenAt === 0 ? Date.now() : state.turnFirstTokenAt,
      };

    case HostMessageType.ToolActivity: {
      const flushedState =
        action.phase === ToolPhase.Start
          ? flushStreaming(flushThinking(state))
          : state;
      const tools = applyToolActivity(flushedState.tools, action);
      return {
        ...flushedState,
        tools,
        liveTurnItems:
          action.phase === ToolPhase.Start
            ? appendToolItem(flushedState.liveTurnItems, action.toolCallId)
            : flushedState.liveTurnItems,
      };
    }

    case HostMessageType.SubAgentActivity: {
      const existing = state.subAgents.find(
        (run) => run.runId === action.runId
      );
      if (!existing) {
        return {
          ...state,
          subAgents: [
            ...state.subAgents,
            {
              runId: action.runId,
              agentType: action.agentType,
              description: action.description,
              toolUseCount: action.toolUseCount ?? 0,
              latestActivity: action.latestActivity,
              status: action.status ?? WebviewSubAgentStatus.Running,
              summary: action.summary,
              model: action.model,
              providerId: action.providerId,
              startedAt: Date.now(),
            },
          ],
        };
      }
      return {
        ...state,
        subAgents: state.subAgents.map((run) =>
          run.runId === action.runId
            ? {
                ...run,
                toolUseCount: action.toolUseCount ?? run.toolUseCount,
                latestActivity: action.latestActivity ?? run.latestActivity,
                model: action.model ?? run.model,
                providerId: action.providerId ?? run.providerId,
                // Metrics stream on progress events, so the footer tracks the
                // run live instead of only settling when it ends.
                usage: action.usage ?? run.usage,
                stats: action.stats ?? run.stats,
                ...(action.phase === WebviewSubAgentPhase.End
                  ? {
                      status: action.status ?? WebviewSubAgentStatus.Completed,
                      summary: action.summary ?? run.summary,
                      endedAt: Date.now(),
                    }
                  : {}),
              }
            : run
        ),
      };
    }

    case HostMessageType.SubAgentTranscript:
      return {
        ...state,
        subAgentTranscripts: {
          ...state.subAgentTranscripts,
          [action.runId]: action.messages,
        },
      };

    case HostMessageType.ApprovalRequest:
      return { ...state, approval: action };

    case HostMessageType.UserInputRequest:
      return { ...state, input: action };

    case LocalActionType.DismissApproval:
      return { ...state, approval: undefined };

    case LocalActionType.DismissInput:
      return { ...state, input: undefined };

    case HostMessageType.UsageUpdate:
      return { ...state, usage: action.usage };

    case HostMessageType.TurnComplete: {
      const completedState = flushThinking(state);
      return {
        ...completedState,
        messages: action.messages,
        usage: action.usage ?? state.usage,
        stats: action.stats ?? state.stats,
        busy: false,
        completedThinkingItems: completedState.liveTurnItems.filter(
          (item): item is LiveThinkingItem =>
            item.kind === LiveTurnItemKind.Thinking
        ),
        // The authoritative message/tool transcript comes from the host after
        // commit; keep only completed thinking visible until the next submit.
        thinking: '',
        thinkingDurationMs: 0,
        thinkingStartedAt: 0,
        streaming: '',
        turnStartedAt: 0,
        turnFirstTokenAt: 0,
        tools: [],
        liveTurnItems: [],
        approval: undefined,
        input: undefined,
      };
    }

    case HostMessageType.WorkspaceFiles:
      return { ...state, workspaceFiles: action.files };

    case HostMessageType.FileSymbols:
      return {
        ...state,
        fileSymbols: { ...state.fileSymbols, [action.path]: action.symbols },
      };

    case HostMessageType.Error: {
      // An aborted turn still streamed real thinking/answer tokens. Those live in
      // `thinking`/`streaming`, which the view only renders while `busy` — so
      // flushing them into `liveTurnItems` keeps the partial response visible
      // instead of vanishing the moment the turn stops (mirrors the CLI, which
      // commits the interrupted partial). Plain errors keep the old behaviour.
      const committed = action.aborted
        ? flushStreaming(flushThinking(state))
        : state;
      return {
        ...committed,
        busy: false,
        error: action.message,
        turnStartedAt: 0,
        turnFirstTokenAt: 0,
        approval: undefined,
        input: undefined,
      };
    }

    case LocalActionType.SelectModel:
      return {
        ...state,
        activeModel: action.modelId,
        providerId: action.providerId,
      };

    case LocalActionType.SetReasoningEffort:
      return {
        ...state,
        reasoningEffortByModel: {
          ...state.reasoningEffortByModel,
          [action.providerId]: {
            ...state.reasoningEffortByModel[action.providerId],
            [action.modelId]: action.effort,
          },
        },
      };

    case LocalActionType.ToggleAutoApprove:
      return { ...state, autoApprove: !state.autoApprove };

    case LocalActionType.ToggleExpandTools:
      return { ...state, expandTools: !state.expandTools };

    case LocalActionType.ToggleThinkingCollapsed:
      return { ...state, thinkingCollapsed: !state.thinkingCollapsed };

    case LocalActionType.ToggleLocalModelAutoRefresh:
      return {
        ...state,
        localModelAutoRefresh: !state.localModelAutoRefresh,
      };

    case LocalActionType.ToggleModelAutoRefresh:
      return {
        ...state,
        modelAutoRefresh: !state.modelAutoRefresh,
      };

    case LocalActionType.ToggleLazyToolLoading:
      return { ...state, lazyToolLoading: !state.lazyToolLoading };

    case LocalActionType.SetDisabledTools:
      return { ...state, disabledTools: action.names };

    case LocalActionType.SetReadLimit:
      return { ...state, maxReadLines: action.lines };

    case LocalActionType.SetHistoryLimit:
      return { ...state, maxHistoryMessages: action.count };

    case LocalActionType.SetAutoCompactThreshold:
      return { ...state, autoCompactThresholdPercent: action.percent };

    case LocalActionType.SetView:
      return { ...state, view: action.view };

    case LocalActionType.ToggleCollapseResponses:
      return { ...state, collapseResponses: !state.collapseResponses };

    case LocalActionType.ToggleConversationSidebar:
      return {
        ...state,
        showConversationSidebar: !state.showConversationSidebar,
      };

    case LocalActionType.SetTitle:
      return { ...state, sessionTitle: action.title };

    case LocalActionType.QueueMessage:
      return {
        ...state,
        queuedMessages: [
          ...state.queuedMessages,
          {
            id: `queued-${Date.now()}-${state.queuedMessages.length}`,
            content: action.content,
            images: action.images,
            ...(action.files?.length ? { files: action.files } : {}),
          },
        ],
      };

    case LocalActionType.DequeueMessage:
      return {
        ...state,
        queuedMessages: state.queuedMessages.filter((m) => m.id !== action.id),
      };

    case LocalActionType.UpdateQueuedMessage:
      return {
        ...state,
        queuedMessages: state.queuedMessages.map((m) =>
          m.id === action.id ? { ...m, content: action.content } : m
        ),
      };

    case LocalActionType.ClearQueue:
      return { ...state, queuedMessages: [] };

    case LocalActionType.ResolveFiles:
      return {
        ...state,
        resolvedFiles: mergeResolved(state.resolvedFiles, action.files),
        revertError: undefined,
      };

    case LocalActionType.UnresolveFile:
      return {
        ...state,
        resolvedFiles: omitResolved(state.resolvedFiles, action.path),
      };

    case HostMessageType.FileReverted:
      // Undo hides the row optimistically; nothing more to do on success. On
      // failure, bring the row back and explain why so the user can retry rather
      // than believing a file was reverted when it wasn't.
      return action.ok
        ? { ...state, revertError: undefined }
        : {
            ...state,
            resolvedFiles: omitResolved(state.resolvedFiles, action.path),
            revertError: action.message ?? `Couldn't undo ${action.path}.`,
          };

    case HostMessageType.TitleUpdate:
      return { ...state, sessionTitle: action.title };

    default:
      return state;
  }
}

/**
 * Records where each file was resolved, keeping the most recent resolution (the
 * one with the highest edit count) so re-resolving after a new edit raises the
 * bar rather than lowering it.
 */
function mergeResolved(
  existing: Record<string, ResolvedFile>,
  files: Array<{ path: string; resolution: ResolvedFile }>
): Record<string, ResolvedFile> {
  const next = { ...existing };
  for (const { path, resolution } of files) {
    const prior = next[path];
    if (!prior || resolution.editCount >= prior.editCount) {
      next[path] = resolution;
    }
  }
  return next;
}

/** Drops a path from the resolved set (e.g. after a failed undo). */
function omitResolved(
  existing: Record<string, ResolvedFile>,
  path: string
): Record<string, ResolvedFile> {
  if (!(path in existing)) return existing;
  const { [path]: _removed, ...rest } = existing;
  return rest;
}

function flushThinking(state: ChatState): ChatState {
  if (!state.thinking.trim()) return state;

  const durationMs =
    state.thinkingDurationMs > 0
      ? state.thinkingDurationMs
      : state.thinkingStartedAt > 0
        ? Date.now() - state.thinkingStartedAt
        : 0;

  return {
    ...state,
    liveTurnItems: [
      ...state.liveTurnItems,
      {
        kind: LiveTurnItemKind.Thinking,
        id: createLiveItemId(),
        content: state.thinking,
        durationMs,
      },
    ],
    thinking: '',
    thinkingDurationMs: 0,
    thinkingStartedAt: 0,
  };
}

function flushStreaming(state: ChatState): ChatState {
  if (!state.streaming.trim()) return state;

  return {
    ...state,
    liveTurnItems: [
      ...state.liveTurnItems,
      {
        kind: LiveTurnItemKind.Message,
        id: createLiveItemId(),
        content: state.streaming,
      },
    ],
    streaming: '',
  };
}

function appendToolItem(
  items: LiveTurnItem[],
  toolCallId: string
): LiveTurnItem[] {
  return [
    ...items,
    { kind: LiveTurnItemKind.Tool, id: createLiveItemId(), toolCallId },
  ];
}

function applyToolActivity(
  tools: ToolActivity[],
  action: Extract<HostToWebview, { type: HostMessageType.ToolActivity }>
): ToolActivity[] {
  if (action.phase === ToolPhase.Start) {
    return [
      ...tools,
      {
        toolCallId: action.toolCallId,
        toolName: action.toolName,
        view: action.view,
        done: false,
        isError: false,
      },
    ];
  }

  return tools.map((tool) =>
    tool.toolCallId === action.toolCallId
      ? {
          ...tool,
          done: true,
          isError: action.isError ?? false,
          // A diff that only materializes on `end` (e.g. a bash deletion, known
          // once the file is gone) wasn't on the start view; fold it in now.
          ...(action.view.diff && !tool.view.diff
            ? { view: { ...tool.view, diff: action.view.diff } }
            : {}),
          ...(action.resultPreview
            ? { resultPreview: action.resultPreview }
            : {}),
        }
      : tool
  );
}
