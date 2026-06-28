import {
  HostMessageType,
  ToolPhase,
  WebviewRole,
  type ApprovalRequestMessage,
  type HostToWebview,
  type UserInputRequestMessage,
  type WebviewMessage,
  type WebviewModel,
  type WebviewProvider,
  type WebviewSessionSummary,
  type WebviewToolView,
  type WebviewUsage,
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
  // The fields below are cleared back to `undefined` on session resets, so they
  // carry an explicit `| undefined` (required under exactOptionalPropertyTypes).
  providerId?: string | undefined;
  activeModel?: string | undefined;
  models: WebviewModel[];
  providers: WebviewProvider[];
  notice?: string | undefined;
  messages: WebviewMessage[];
  busy: boolean;
  thinking: string;
  streaming: string;
  tools: ToolActivity[];
  approval?: ApprovalRequestMessage | undefined;
  input?: UserInputRequestMessage | undefined;
  usage?: WebviewUsage | undefined;
  error?: string | undefined;
  autoApplyWrites: boolean;
  expandTools: boolean;
  maxReadLines: number;
  sessionTitle?: string | undefined;
}

export const initialState: ChatState = {
  status: ChatStatus.Loading,
  view: 'sessions',
  sessions: [],
  models: [],
  providers: [],
  messages: [],
  busy: false,
  thinking: '',
  streaming: '',
  tools: [],
  autoApplyWrites: false,
  expandTools: false,
  maxReadLines: 200,
};

/** Local-only actions, distinct from host messages, for optimistic UI updates. */
export enum LocalActionType {
  OptimisticSubmit = 'optimisticSubmit',
  DismissApproval = 'dismissApproval',
  DismissInput = 'dismissInput',
  SelectModel = 'selectModel',
  ToggleAutoWrites = 'toggleAutoWrites',
  ToggleExpandTools = 'toggleExpandTools',
  SetReadLimit = 'setReadLimit',
  SetView = 'setView',
  SetTitle = 'setTitle',
}

export type LocalAction =
  | { type: LocalActionType.OptimisticSubmit; content: string }
  | { type: LocalActionType.DismissApproval }
  | { type: LocalActionType.DismissInput }
  | { type: LocalActionType.SelectModel; modelId: string }
  | { type: LocalActionType.ToggleAutoWrites }
  | { type: LocalActionType.ToggleExpandTools }
  | { type: LocalActionType.SetReadLimit; lines: number }
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
        providers: action.providers,
        messages: action.messages,
        notice: action.notice,
        busy: false,
        thinking: '',
        streaming: '',
        tools: [],
        approval: undefined,
        input: undefined,
        error: undefined,
        autoApplyWrites: action.autoApplyWrites,
        expandTools: action.expandTools,
        maxReadLines: action.maxReadLines,
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
        streaming: '',
        tools: [],
        error: undefined,
      };

    case HostMessageType.Token:
      return { ...state, streaming: state.streaming + action.token };

    case HostMessageType.Thinking:
      return { ...state, thinking: state.thinking + action.token };

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

    case HostMessageType.TurnComplete:
      return {
        ...state,
        messages: action.messages,
        usage: action.usage ?? state.usage,
        busy: false,
        thinking: '',
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
      return { ...state, activeModel: action.modelId };

    case LocalActionType.ToggleAutoWrites:
      return { ...state, autoApplyWrites: !state.autoApplyWrites };

    case LocalActionType.ToggleExpandTools:
      return { ...state, expandTools: !state.expandTools };

    case LocalActionType.SetReadLimit:
      return { ...state, maxReadLines: action.lines };

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
