import {
  HostMessageType,
  ToolPhase,
  WebviewRole,
  type ApprovalRequestMessage,
  type HostToWebview,
  type UserInputRequestMessage,
  type WebviewMessage,
  type WebviewModel,
  type WebviewSessionSummary,
  type WebviewToolView,
  type WebviewUsage,
  type WebviewStats,
} from '@ext/shared/protocol';

/** A tool invocation as the transcript tracks it across start/end events. */
export interface ToolActivity {
  toolCallId: string;
  toolName: string;
  view: WebviewToolView;
  done: boolean;
  isError: boolean;
  resultPreview?: string;
}

export enum ChatStatus {
  Loading = 'loading',
  Ready = 'ready',
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
  autoApplyWrites: boolean;
  expandTools: boolean;
  maxReadLines: number;
  /** Recent messages sent to the model per request; 0 means "off" (send all). */
  maxHistoryMessages: number;
  /** When true, thinking blocks start collapsed (user must click to expand). */
  thinkingCollapsed: boolean;
  sessionTitle?: string | undefined;
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
  autoApplyWrites: false,
  expandTools: false,
  maxReadLines: 200,
  maxHistoryMessages: 50,
  thinkingCollapsed: false,
};

/** Local-only actions, distinct from host messages, for optimistic UI updates. */
export enum LocalActionType {
  OptimisticSubmit = 'optimisticSubmit',
  DismissApproval = 'dismissApproval',
  DismissInput = 'dismissInput',
  SelectModel = 'selectModel',
  ToggleAutoWrites = 'toggleAutoWrites',
  ToggleExpandTools = 'toggleExpandTools',
  ToggleThinkingCollapsed = 'toggleThinkingCollapsed',
  SetReadLimit = 'setReadLimit',
  SetHistoryLimit = 'setHistoryLimit',
  SetView = 'setView',
  SetTitle = 'setTitle',
}

export type LocalAction =
  | { type: LocalActionType.OptimisticSubmit; content: string }
  | { type: LocalActionType.DismissApproval }
  | { type: LocalActionType.DismissInput }
  | { type: LocalActionType.SelectModel; modelId: string; providerId: string }
  | { type: LocalActionType.ToggleAutoWrites }
  | { type: LocalActionType.ToggleExpandTools }
  | { type: LocalActionType.ToggleThinkingCollapsed }
  | { type: LocalActionType.SetReadLimit; lines: number }
  | { type: LocalActionType.SetHistoryLimit; count: number }
  | { type: LocalActionType.SetView; view: ChatView }
  | { type: LocalActionType.SetTitle; title: string };

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
        error: undefined,
        usage: undefined,
        stats: undefined,
        autoApplyWrites: action.autoApplyWrites,
        expandTools: action.expandTools,
        maxReadLines: action.maxReadLines,
        maxHistoryMessages: action.maxHistoryMessages,
        thinkingCollapsed: action.thinkingCollapsed,
        sessionTitle: action.sessionTitle,
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
          },
        ],
        busy: true,
        thinking: '',
        thinkingDurationMs: 0,
        thinkingStartedAt: 0,
        streaming: '',
        tools: [],
        error: undefined,
      };

    case HostMessageType.Token:
      // First regular token after thinking — stop the thinking timer.
      return {
        ...state,
        streaming: state.streaming + action.token,
        thinkingDurationMs:
          state.thinkingStartedAt > 0 && state.thinkingDurationMs === 0
            ? Date.now() - state.thinkingStartedAt
            : state.thinkingDurationMs,
      };

    case HostMessageType.Thinking:
      return {
        ...state,
        thinking: state.thinking + action.token,
        thinkingStartedAt:
          state.thinkingStartedAt === 0 ? Date.now() : state.thinkingStartedAt,
      };

    case HostMessageType.ToolActivity:
      return { ...state, tools: applyToolActivity(state.tools, action) };

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

    case HostMessageType.TurnComplete:
      return {
        ...state,
        messages: action.messages,
        usage: action.usage ?? state.usage,
        stats: action.stats ?? state.stats,
        busy: false,
        // Keep thinking content visible after the turn; cleared on next submit.
        streaming: '',
        tools: [],
        approval: undefined,
        input: undefined,
      };

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

    case LocalActionType.ToggleAutoWrites:
      return { ...state, autoApplyWrites: !state.autoApplyWrites };

    case LocalActionType.ToggleExpandTools:
      return { ...state, expandTools: !state.expandTools };

    case LocalActionType.ToggleThinkingCollapsed:
      return { ...state, thinkingCollapsed: !state.thinkingCollapsed };

    case LocalActionType.SetReadLimit:
      return { ...state, maxReadLines: action.lines };

    case LocalActionType.SetHistoryLimit:
      return { ...state, maxHistoryMessages: action.count };

    case LocalActionType.SetView:
      return { ...state, view: action.view };

    case LocalActionType.SetTitle:
      return { ...state, sessionTitle: action.title };

    case HostMessageType.TitleUpdate:
      return { ...state, sessionTitle: action.title };

    default:
      return state;
  }
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
          ...(action.resultPreview
            ? { resultPreview: action.resultPreview }
            : {}),
        }
      : tool
  );
}
