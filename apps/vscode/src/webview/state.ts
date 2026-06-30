import {
  HostMessageType,
  ToolPhase,
  WebviewRole,
  type ApprovalRequestMessage,
  type HostToWebview,
  type UserInputRequestMessage,
  type WebviewImage,
  type WebviewMessage,
  type WebviewModel,
  type WebviewReasoningChoice,
  type WebviewSessionSummary,
  type WebviewToolView,
  type WebviewUsage,
  type WebviewStats,
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
}

export type ChatView = 'sessions' | 'chat' | 'model-picker';

export interface ChatState {
  status: ChatStatus;
  view: ChatView;
  sessions: WebviewSessionSummary[];
  hasConnectedProvider: boolean;
  // The fields below are cleared back to `undefined` on session resets, so they
  // carry an explicit `| undefined` (required under exactOptionalPropertyTypes).
  providerId?: string | undefined;
  activeModel?: string | undefined;
  models: WebviewModel[];
  notice?: string | undefined;
  messages: WebviewMessage[];
  busy: boolean;
  thinking: string;
  /** Milliseconds the model spent thinking; 0 while thinking is in progress or unknown. */
  thinkingDurationMs: number;
  /** Timestamp (Date.now()) when the first thinking token arrived this turn. */
  thinkingStartedAt: number;
  streaming: string;
  tools: ToolActivity[];
  approval?: ApprovalRequestMessage | undefined;
  input?: UserInputRequestMessage | undefined;
  usage?: WebviewUsage | undefined;
  stats?: WebviewStats | undefined;
  error?: string | undefined;
  /** Completed in-flight turn chunks, in the order they streamed. */
  liveTurnItems: LiveTurnItem[];
  /** Thinking segments from the just-completed turn, kept visible after commit. */
  completedThinkingItems: LiveThinkingItem[];
  autoApplyWrites: boolean;
  expandTools: boolean;
  maxReadLines: number;
  /** Recent context window items sent to the model per request; 0 means "off" (send all). */
  maxHistoryMessages: number;
  /** When true, thinking blocks start collapsed (user must click to expand). */
  thinkingCollapsed: boolean;
  /** When true (default), local providers refetch their model list every load. */
  localModelAutoRefresh: boolean;
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
}

export const initialState: ChatState = {
  status: ChatStatus.Loading,
  view: 'sessions',
  sessions: [],
  hasConnectedProvider: false,
  models: [],
  messages: [],
  busy: false,
  thinking: '',
  thinkingDurationMs: 0,
  thinkingStartedAt: 0,
  streaming: '',
  tools: [],
  liveTurnItems: [],
  completedThinkingItems: [],
  autoApplyWrites: false,
  expandTools: false,
  maxReadLines: 200,
  maxHistoryMessages: 50,
  thinkingCollapsed: false,
  localModelAutoRefresh: true,
  reasoningEffortByModel: {},
  resolvedFiles: {},
  queuedMessages: [],
};

/** Local-only actions, distinct from host messages, for optimistic UI updates. */
export enum LocalActionType {
  OptimisticSubmit = 'optimisticSubmit',
  DismissApproval = 'dismissApproval',
  DismissInput = 'dismissInput',
  SelectModel = 'selectModel',
  SetReasoningEffort = 'setReasoningEffort',
  ToggleAutoWrites = 'toggleAutoWrites',
  ToggleExpandTools = 'toggleExpandTools',
  ToggleThinkingCollapsed = 'toggleThinkingCollapsed',
  ToggleLocalModelAutoRefresh = 'toggleLocalModelAutoRefresh',
  SetReadLimit = 'setReadLimit',
  SetHistoryLimit = 'setHistoryLimit',
  SetView = 'setView',
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
  | { type: LocalActionType.ToggleAutoWrites }
  | { type: LocalActionType.ToggleExpandTools }
  | { type: LocalActionType.ToggleThinkingCollapsed }
  | { type: LocalActionType.ToggleLocalModelAutoRefresh }
  | { type: LocalActionType.SetReadLimit; lines: number }
  | { type: LocalActionType.SetHistoryLimit; count: number }
  | { type: LocalActionType.SetView; view: ChatView }
  | { type: LocalActionType.SetTitle; title: string }
  | { type: LocalActionType.QueueMessage; content: string; images: WebviewImage[] }
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
export function reducer(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    case HostMessageType.Ready:
      return {
        ...state,
        status: ChatStatus.Ready,
        view: 'chat',
        providerId: action.providerId,
        activeModel: action.activeModel,
        models: action.models,
        messages: action.messages,
        notice: action.notice,
        busy: false,
        thinking: '',
        streaming: '',
        tools: [],
        approval: undefined,
        input: undefined,
        liveTurnItems: [],
        completedThinkingItems: [],
        error: undefined,
        usage: undefined,
        stats: undefined,
        autoApplyWrites: action.autoApplyWrites,
        expandTools: action.expandTools,
        maxReadLines: action.maxReadLines,
        maxHistoryMessages: action.maxHistoryMessages,
        thinkingCollapsed: action.thinkingCollapsed,
        localModelAutoRefresh: action.localModelAutoRefresh,
        reasoningEffortByModel: action.reasoningEffortByModel,
        sessionTitle: action.sessionTitle,
        // A fresh session/snapshot starts with an empty changes panel.
        resolvedFiles: {},
        revertError: undefined,
        // A new session/snapshot drops anything that was queued.
        queuedMessages: [],
      };

    case HostMessageType.ModelsUpdate:
      return { ...state, models: action.models };

    case HostMessageType.SessionsList:
      return {
        ...state,
        status: ChatStatus.Ready,
        view: 'sessions',
        sessions: action.sessions,
        hasConnectedProvider: action.hasConnectedProvider,
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
        tools: [],
        liveTurnItems: [],
        completedThinkingItems: [],
        error: undefined,
      };

    case HostMessageType.Token: {
      // First answer token after thinking: commit that thinking segment inline so
      // it settles above the streaming answer instead of growing in one block.
      const nextState = flushThinking(state);
      return {
        ...nextState,
        streaming: nextState.streaming + action.token,
      };
    }

    case HostMessageType.Thinking:
      return {
        ...state,
        thinking: state.thinking + action.token,
        thinkingStartedAt:
          state.thinkingStartedAt === 0 ? Date.now() : state.thinkingStartedAt,
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
        tools: [],
        liveTurnItems: [],
        approval: undefined,
        input: undefined,
      };
    }

    case HostMessageType.Error:
      return {
        ...state,
        busy: false,
        error: action.message,
        approval: undefined,
        input: undefined,
      };

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

    case LocalActionType.ToggleAutoWrites:
      return { ...state, autoApplyWrites: !state.autoApplyWrites };

    case LocalActionType.ToggleExpandTools:
      return { ...state, expandTools: !state.expandTools };

    case LocalActionType.ToggleThinkingCollapsed:
      return { ...state, thinkingCollapsed: !state.thinkingCollapsed };

    case LocalActionType.ToggleLocalModelAutoRefresh:
      return {
        ...state,
        localModelAutoRefresh: !state.localModelAutoRefresh,
      };

    case LocalActionType.SetReadLimit:
      return { ...state, maxReadLines: action.lines };

    case LocalActionType.SetHistoryLimit:
      return { ...state, maxHistoryMessages: action.count };

    case LocalActionType.SetView:
      return { ...state, view: action.view };

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
