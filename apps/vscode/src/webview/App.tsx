import * as React from 'react';

import {
  HostMessageType,
  SettingsSection,
  WebviewMessageType,
  WebviewRole,
  type WebviewImage,
  type WebviewModel,
  type WebviewReasoningChoice,
  type WebviewStats,
} from '@ext/shared/protocol';
import { onHostMessage, postToHost } from '@ext/webview/vscode-api';
import {
  ChatStatus,
  LiveTurnItemKind,
  LocalActionType,
  initialState,
  reducer,
} from '@ext/webview/state';
import { MessageView } from '@ext/webview/components/MessageView';
import { renderMarkdown } from '@ext/webview/markdown';
import { ToolActivityView } from '@ext/webview/components/ToolActivityView';
import { ApprovalPrompt, InputPrompt } from '@ext/webview/components/Prompts';
import { Composer } from '@ext/webview/components/Composer';
import { SessionsView } from '@ext/webview/components/SessionsView';
import { SessionSwitcher } from '@ext/webview/components/SessionSwitcher';
import { ConversationSidebar } from '@ext/webview/components/ConversationSidebar';
import { ModelPickerView } from '@ext/webview/components/ModelPickerView';
import {
  ChatIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CollapseIcon,
  JsonIcon,
  PencilIcon,
} from '@ext/webview/components/Icons';
import { ChangesPanel } from '@ext/webview/components/ChangesPanel';
import { deriveChangedFiles, type ChangedFile } from '@ext/webview/changes';
import { selectThinkingItems } from '@ext/webview/thinking-items';
import { BUILD_MODE_ID } from '@core/domain/chat-mode';
import { ToolName } from '@core/domain/tool-name';

const PRESENT_PLAN_TOOL = ToolName.PresentPlan;

export function App(): React.JSX.Element {
  const [state, dispatch] = React.useReducer(reducer, initialState);
  // The image (data URL) shown full-size in the preview modal, or null when closed.
  const [previewImage, setPreviewImage] = React.useState<string | null>(null);
  // The queued message being edited inline, and its working draft text.
  const [editingQueuedId, setEditingQueuedId] = React.useState<string | null>(
    null
  );
  const [queuedDraft, setQueuedDraft] = React.useState('');
  // The composer's unsent draft, mirrored here so it survives the Composer being
  // unmounted when a full-screen view (model picker, sessions) takes over. Kept
  // in refs rather than render state so typing doesn't re-render the transcript.
  const composerDraftRef = React.useRef('');
  const composerDraftImagesRef = React.useRef<WebviewImage[]>([]);
  const persistComposerDraft = React.useCallback(
    (draft: string, images: WebviewImage[]): void => {
      composerDraftRef.current = draft;
      composerDraftImagesRef.current = images;
    },
    []
  );
  // Live tok/s while a turn streams, mirroring the CLI: the host only sends the
  // real stats at turn-end, so estimate throughput here from the streamed text
  // length and the time since the first token, refreshed on a timer. The turn's
  // start/first-token timestamps live in reducer state so a mid-turn resume can
  // seed them from the host — restarting a local clock on reopen would divide
  // the whole replayed buffer by ~0 elapsed and spike the rate.
  const [statsTick, setStatsTick] = React.useState(0);

  React.useEffect(() => {
    if (!state.busy) return undefined;
    const id = setInterval(() => setStatsTick((t) => t + 1), 150);
    return () => clearInterval(id);
  }, [state.busy]);

  // Self-dismiss transient notices (e.g. the "auto-compact is close" warning):
  // the host stamps them with a timeout, persistent ones carry none.
  React.useEffect(() => {
    if (!state.notice || !state.noticeTimeoutMs) return undefined;
    const id = setTimeout(() => {
      dispatch({ type: HostMessageType.Notice, notice: '' });
    }, state.noticeTimeoutMs);
    return () => clearTimeout(id);
  }, [state.notice, state.noticeTimeoutMs]);

  const liveStats = React.useMemo<WebviewStats | undefined>(() => {
    if (!state.busy || state.turnStartedAt === 0) return undefined;
    const now = Date.now();
    const firstToken = state.turnFirstTokenAt || now;
    const ttftMs = Math.max(firstToken - state.turnStartedAt, 0);
    const genElapsedMs = Math.max(now - firstToken, 1);
    // Count the whole turn's output, not just the visible buffers: once the
    // first answer token lands, thinking is flushed out of `state.thinking` into
    // `liveTurnItems`, so summing only thinking+streaming would collapse the
    // count mid-turn (rate drops to ~0, then climbs). Include committed
    // thinking/message items so the total only grows.
    const committed = state.liveTurnItems.reduce(
      (sum, item) =>
        item.kind === LiveTurnItemKind.Thinking ||
        // Steering echoes render as user items in the live turn; they're the
        // user's text, not model output, so keep them out of the tok/s count.
        (item.kind === LiveTurnItemKind.Message &&
          item.role !== WebviewRole.User)
          ? sum + item.content.length
          : sum,
      0
    );
    const totalChars =
      committed + state.thinking.length + state.streaming.length;
    const estimatedTokens =
      totalChars > 0 ? Math.max(1, Math.round(totalChars / 4)) : 0;
    return {
      ttftMs,
      tokensPerSecond: estimatedTokens / (genElapsedMs / 1000),
      // The running average only folds in completed turns; reuse the last known.
      avgTokensPerSecond: state.stats?.avgTokensPerSecond ?? 0,
    };
    // statsTick drives the periodic refresh.
  }, [
    state.busy,
    state.streaming,
    state.thinking,
    state.liveTurnItems,
    state.stats,
    state.turnStartedAt,
    state.turnFirstTokenAt,
    statsTick,
  ]);

  const transcriptRef = React.useRef<HTMLDivElement>(null);
  // Whether new content should auto-scroll. True while the user is parked at the
  // bottom; flips to false the moment they scroll up to read earlier output, so
  // streaming tokens don't yank them back down. Re-arms once they return to the
  // bottom. Defaults to true so the first render and resumed sessions land there.
  const stickToBottomRef = React.useRef(true);

  // Subscribe to host messages once, and ask for the initial snapshot.
  React.useEffect(() => {
    const unsubscribe = onHostMessage(dispatch);
    postToHost({ type: WebviewMessageType.Init });
    return unsubscribe;
  }, []);

  // Persist changes-panel resolutions to the host whenever they change, so they
  // survive reopening the chat. Skips the first render (nothing resolved yet) to
  // avoid clobbering a session's saved map with an empty one before Ready lands.
  const resolvedHydrated = React.useRef(false);
  React.useEffect(() => {
    if (!resolvedHydrated.current) {
      resolvedHydrated.current = true;
      return;
    }
    postToHost({
      type: WebviewMessageType.SaveResolvedFiles,
      resolved: state.resolvedFiles,
    });
  }, [state.resolvedFiles]);

  // Escape closes the image preview modal.
  React.useEffect(() => {
    if (!previewImage) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPreviewImage(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [previewImage]);

  // Track whether the user is pinned to the bottom. A small threshold absorbs
  // sub-pixel rounding and the height growth from a token that lands between the
  // scroll event and this read.
  // Whether to show the floating "jump to bottom" button. True once the user has
  // scrolled meaningfully away from the bottom; hidden again when they return.
  const [showJumpToBottom, setShowJumpToBottom] = React.useState(false);
  // Whether to show the floating "jump to top" button. Only while the user is
  // unpinned from the bottom (i.e. they started scrolling up) and there's
  // meaningful content above — never while parked at the bottom or the top.
  const [showJumpToTop, setShowJumpToTop] = React.useState(false);

  // Set when we move the scrollbar ourselves, so the resulting scroll event
  // isn't mistaken for the user scrolling up. Without this, content that grows
  // between our pin and the event (a tool card laying out its output, an image
  // loading) makes the measured distance-from-bottom nonzero and silently
  // unsticks auto-scroll.
  const programmaticScrollRef = React.useRef(false);

  const pinToBottom = React.useCallback((): void => {
    const el = transcriptRef.current;
    if (!el) return;
    const before = el.scrollTop;
    el.scrollTop = el.scrollHeight;
    // Only flag when the assignment actually moved the viewport; otherwise no
    // scroll event fires and a stale flag would swallow the user's next scroll.
    if (el.scrollTop !== before) programmaticScrollRef.current = true;
  }, []);

  const onTranscriptScroll = (): void => {
    const el = transcriptRef.current;
    if (!el) return;
    if (programmaticScrollRef.current) {
      programmaticScrollRef.current = false;
      setShowJumpToBottom(false);
      // A programmatic move is always a pin to the bottom — keep it hidden.
      setShowJumpToTop(false);
      return;
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom <= 24;
    // A larger threshold than the auto-scroll pin so the button doesn't flicker
    // in and out on the last sliver of scroll.
    setShowJumpToBottom(distanceFromBottom > 120);
    setShowJumpToTop(distanceFromBottom > 120 && el.scrollTop > 120);
  };

  const jumpToBottom = (): void => {
    stickToBottomRef.current = true;
    setShowJumpToBottom(false);
    setShowJumpToTop(false);
    pinToBottom();
  };

  const jumpToTop = (): void => {
    const el = transcriptRef.current;
    if (!el) return;
    stickToBottomRef.current = false;
    setShowJumpToTop(false);
    // Not flagged as programmatic: the resulting scroll event re-derives the
    // button states (top hidden, bottom shown) from the new position.
    el.scrollTop = 0;
  };

  // Keep the latest content in view as tokens stream, messages arrive, and tool
  // cards render. Watching the content's real size (not React state) means
  // height that lands after commit — tool output, syntax highlighting, images —
  // still pins, while the user staying scrolled up is always respected.
  //
  // Attached as a callback ref, not a mount effect: the transcript is only in
  // the tree on the chat view (sessions/loading return early), so an effect
  // that runs once would find nothing to observe and auto-scroll would be dead
  // for the whole session. The callback re-fires on every mount/unmount.
  const contentObserverRef = React.useRef<ResizeObserver | null>(null);
  const observeTranscriptContent = React.useCallback(
    (node: HTMLDivElement | null): void => {
      contentObserverRef.current?.disconnect();
      contentObserverRef.current = null;
      if (!node) return;
      const observer = new ResizeObserver(() => {
        if (stickToBottomRef.current) pinToBottom();
      });
      // ResizeObserver fires once on observe, which conveniently pins a freshly
      // opened chat to its latest message.
      observer.observe(node);
      contentObserverRef.current = observer;
    },
    [pinToBottom]
  );

  // When an approval/input gate appears it needs the user to act, so reveal it
  // unconditionally — even if they'd scrolled up — and re-arm auto-scroll. The
  // gate's diff/preview can grow the transcript after this commit, so scroll on
  // the next frame (post-paint) and pin to the real bottom rather than the
  // height measured mid-render.
  React.useEffect(() => {
    if (!state.approval && !state.input) return;
    const reveal = (): void => {
      stickToBottomRef.current = true;
      pinToBottom();
    };
    reveal();
    const raf = requestAnimationFrame(reveal);
    return () => cancelAnimationFrame(raf);
  }, [state.approval, state.input, pinToBottom]);

  const sendNow = (content: string, images: WebviewImage[]): void => {
    // Sending a new message should always snap to it, even if the user had
    // scrolled up while reading the previous turn.
    stickToBottomRef.current = true;
    dispatch({ type: LocalActionType.OptimisticSubmit, content, images });
    // Pin explicitly on the next frame rather than leaning only on the content
    // ResizeObserver. When the changes panel is open it sits outside the scroll
    // container and can absorb the layout change, so the observer may not fire
    // and the optimistic message wouldn't be scrolled into view. Post-paint so
    // the just-committed message is measured at its real height.
    requestAnimationFrame(pinToBottom);
    postToHost({
      type: WebviewMessageType.Submit,
      content,
      ...(images.length ? { images } : {}),
    });
  };

  const submit = (content: string, images: WebviewImage[]): void => {
    // A turn is in flight — hold this message and send it once the agent is idle
    // instead of erroring. It's shown as a pending pill the user can cancel.
    if (state.busy) {
      dispatch({ type: LocalActionType.QueueMessage, content, images });
      return;
    }
    sendNow(content, images);
  };

  // Flush the queue once the active turn finishes: combine the held messages into
  // a single turn (joined by blank lines, images concatenated) and send it.
  React.useEffect(() => {
    if (state.busy || state.queuedMessages.length === 0) return;
    if (!state.activeModel) return;
    // Don't send a queued message out from under an in-progress edit.
    if (editingQueuedId !== null) return;
    const content = state.queuedMessages
      .map((m) => m.content)
      .filter((c) => c.trim().length > 0)
      .join('\n\n');
    const images = state.queuedMessages.flatMap((m) => m.images);
    dispatch({ type: LocalActionType.ClearQueue });
    sendNow(content, images);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.busy, state.queuedMessages, editingQueuedId]);

  // Mirror the text follow-ups to the host so the in-flight turn can steer on
  // them at its next step instead of waiting for the turn to finish. Only
  // text-only entries are steerable — an image-bearing follow-up stays queued
  // and sends as its own turn once the current one ends. Re-sent on every queue
  // change (add/edit/delete) so the host always has the latest editable state.
  React.useEffect(() => {
    postToHost({
      type: WebviewMessageType.SyncSteeringQueue,
      messages: state.queuedMessages
        .filter((m) => m.images.length === 0 && m.content.trim().length > 0)
        .map((m) => ({ id: m.id, content: m.content })),
    });
  }, [state.queuedMessages]);

  const dequeueMessage = (id: string): void => {
    dispatch({ type: LocalActionType.DequeueMessage, id });
  };

  const startEditQueued = (id: string, content: string): void => {
    setEditingQueuedId(id);
    setQueuedDraft(content);
  };

  const commitEditQueued = (): void => {
    const id = editingQueuedId;
    if (id === null) return;
    const trimmed = queuedDraft.trim();
    // Clearing the text cancels the queued message entirely.
    if (trimmed) {
      dispatch({
        type: LocalActionType.UpdateQueuedMessage,
        id,
        content: queuedDraft,
      });
    } else {
      dispatch({ type: LocalActionType.DequeueMessage, id });
    }
    setEditingQueuedId(null);
    setQueuedDraft('');
  };

  const cancelEditQueued = (): void => {
    setEditingQueuedId(null);
    setQueuedDraft('');
  };

  const cancel = (): void => {
    postToHost({ type: WebviewMessageType.Cancel });
  };

  const requestWorkspaceFiles = (): void => {
    postToHost({ type: WebviewMessageType.RequestWorkspaceFiles });
  };

  const requestFileSymbols = (path: string): void => {
    postToHost({ type: WebviewMessageType.RequestFileSymbols, path });
  };

  const respondApproval = (id: string, approved: boolean): void => {
    postToHost({ type: WebviewMessageType.ApprovalResponse, id, approved });
    dispatch({ type: LocalActionType.DismissApproval });
  };

  // Approve this tool and flip on auto-approve so the rest of the turn (and
  // future turns) run without prompting. The prompt only appears while
  // auto-approve is off, so toggling reliably turns it on.
  const approveAllTools = (id: string): void => {
    respondApproval(id, true);
    if (!state.autoApprove) toggleAutoApprove();
  };

  const respondInput = (id: string, value: string): void => {
    postToHost({ type: WebviewMessageType.UserInputResponse, id, value });
    dispatch({ type: LocalActionType.DismissInput });
  };

  const selectModel = (model: WebviewModel): void => {
    dispatch({
      type: LocalActionType.SelectModel,
      modelId: model.id,
      providerId: model.providerId,
    });
    postToHost({
      type: WebviewMessageType.SelectModel,
      modelId: model.id,
      providerId: model.providerId,
    });
  };

  const setReasoningEffort = (
    model: WebviewModel,
    effort: WebviewReasoningChoice
  ): void => {
    dispatch({
      type: LocalActionType.SetReasoningEffort,
      modelId: model.id,
      providerId: model.providerId,
      effort,
    });
    postToHost({
      type: WebviewMessageType.SetReasoningEffort,
      modelId: model.id,
      providerId: model.providerId,
      effort,
    });
  };

  const newSession = (): void => {
    // Same as openSession: a new chat starts pinned to the (empty) bottom so
    // the first streamed reply auto-scrolls.
    stickToBottomRef.current = true;
    postToHost({ type: WebviewMessageType.NewSession });
  };

  const goBack = (): void => {
    postToHost({ type: WebviewMessageType.ListSessions });
  };

  const openSession = (sessionId: string): void => {
    // A freshly opened session should always start at its latest message, even
    // if the user had scrolled up in the previous chat (the ref survives the
    // transcript unmounting, so it would otherwise stay unpinned).
    stickToBottomRef.current = true;
    postToHost({ type: WebviewMessageType.OpenSession, sessionId });
  };

  const deleteSession = (sessionId: string): void => {
    // The host shows a native confirmation dialog before removing anything.
    postToHost({ type: WebviewMessageType.DeleteSession, sessionId });
  };

  const renameSession = (sessionId: string, title: string): void => {
    postToHost({ type: WebviewMessageType.RenameSession, sessionId, title });
  };

  const clearAllSessions = (): void => {
    // The host confirms before deleting every saved session.
    postToHost({ type: WebviewMessageType.ClearSessions });
  };

  const openModelPicker = (): void => {
    dispatch({ type: LocalActionType.SetView, view: 'model-picker' });
  };

  const refreshModels = (): void => {
    postToHost({ type: WebviewMessageType.RefreshModels });
  };

  const viewChatLog = (): void => {
    postToHost({ type: WebviewMessageType.ViewChatLog });
  };

  const toggleCollapseResponses = (): void => {
    dispatch({ type: LocalActionType.ToggleCollapseResponses });
  };

  const toggleConversationSidebar = (): void => {
    dispatch({ type: LocalActionType.ToggleConversationSidebar });
  };

  // Jumps the transcript to a message picked in the conversation sidebar. The
  // sidebar only lists committed messages, each anchored by MessageView's domId.
  const scrollToMessage = (messageId: string): void => {
    document
      .getElementById(`msg-${messageId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const closeModelPicker = (): void => {
    dispatch({ type: LocalActionType.SetView, view: 'chat' });
  };

  const connectProvider = (): void => {
    // Connecting (including OAuth sign-in) happens inline in the Settings tab;
    // reveal it focused on Providers rather than shelling out to the CLI.
    postToHost({
      type: WebviewMessageType.OpenSettings,
      section: SettingsSection.Providers,
    });
  };

  const openSettings = (): void => {
    // Settings lives in its own editor tab (a separate webview panel); ask the
    // host to reveal it rather than swapping the sidebar's view.
    postToHost({ type: WebviewMessageType.OpenSettings });
  };

  const toggleAutoApprove = (): void => {
    dispatch({ type: LocalActionType.ToggleAutoApprove });
    postToHost({ type: WebviewMessageType.ToggleAutoApprove });
  };

  const toggleExpandTools = (): void => {
    dispatch({ type: LocalActionType.ToggleExpandTools });
    postToHost({ type: WebviewMessageType.ToggleExpandTools });
  };

  const toggleThinkingCollapsed = (): void => {
    dispatch({ type: LocalActionType.ToggleThinkingCollapsed });
    postToHost({ type: WebviewMessageType.ToggleThinkingCollapsed });
  };

  const toggleLocalModelAutoRefresh = (): void => {
    dispatch({ type: LocalActionType.ToggleLocalModelAutoRefresh });
    postToHost({ type: WebviewMessageType.ToggleLocalModelAutoRefresh });
  };

  const toggleLazyToolLoading = (): void => {
    dispatch({ type: LocalActionType.ToggleLazyToolLoading });
    postToHost({ type: WebviewMessageType.ToggleLazyToolLoading });
  };

  const setDisabledTools = (names: string[]): void => {
    dispatch({ type: LocalActionType.SetDisabledTools, names });
    postToHost({ type: WebviewMessageType.SetDisabledTools, names });
  };

  const setReadLimit = (lines: number): void => {
    dispatch({ type: LocalActionType.SetReadLimit, lines });
    postToHost({ type: WebviewMessageType.SetReadLimit, lines });
  };

  const setHistoryLimit = (count: number): void => {
    dispatch({ type: LocalActionType.SetHistoryLimit, count });
    postToHost({ type: WebviewMessageType.SetHistoryLimit, count });
  };

  const setAutoCompactThreshold = (percent: number): void => {
    dispatch({ type: LocalActionType.SetAutoCompactThreshold, percent });
    postToHost({ type: WebviewMessageType.SetAutoCompactThreshold, percent });
  };

  const compactSession = (): void => {
    postToHost({ type: WebviewMessageType.CompactSession });
  };

  // Every file the agent edited/created this session, minus those the user has
  // already kept or undone (and not edited again since). Recomputed from the
  // authoritative transcript plus any in-flight tool activity.
  const resolvedMap = React.useMemo(
    () => new Map(Object.entries(state.resolvedFiles)),
    [state.resolvedFiles]
  );
  const changedFiles = React.useMemo(
    () =>
      deriveChangedFiles(
        state.messages,
        state.tools,
        resolvedMap,
        state.approval?.view.path
      ),
    [state.messages, state.tools, resolvedMap, state.approval]
  );

  // Keeping a file leaves its current content on disk, so that becomes the
  // baseline for any later changes. Undoing reverts it, so the baseline is the
  // content it was reverted to.
  const keepFile = (file: ChangedFile): void => {
    dispatch({
      type: LocalActionType.ResolveFiles,
      files: [
        {
          path: file.path,
          resolution: { editCount: file.editCount, baseline: file.current },
        },
      ],
    });
  };

  const undoFile = (file: ChangedFile): void => {
    // Hide it immediately; the host confirms via FileReverted and the reducer
    // brings the row back if the on-disk revert failed.
    dispatch({
      type: LocalActionType.ResolveFiles,
      files: [
        {
          path: file.path,
          resolution: { editCount: file.editCount, baseline: file.baseline },
        },
      ],
    });
    postToHost({
      type: WebviewMessageType.RevertFile,
      path: file.path,
      oldText: file.baseline,
      created: file.created,
    });
  };

  const keepAllFiles = (): void => {
    for (const file of changedFiles) keepFile(file);
  };

  const undoAllFiles = (): void => {
    for (const file of changedFiles) undoFile(file);
  };

  const openFile = (path: string): void => {
    postToHost({ type: WebviewMessageType.OpenFile, path });
  };

  const openDiff = (file: ChangedFile): void => {
    postToHost({
      type: WebviewMessageType.OpenDiff,
      path: file.path,
      baseline: file.baseline,
      created: file.created,
    });
  };

  const openMcpConfig = (): void => {
    postToHost({ type: WebviewMessageType.OpenMcpConfig });
  };

  const openPromptSettings = (): void => {
    // Reveal the Settings tab focused on System Prompts, where every mode's
    // prompt (including the built-in defaults) can be edited.
    postToHost({
      type: WebviewMessageType.OpenSettings,
      section: SettingsSection.Prompts,
    });
  };

  const selectMode = (modeId: string): void => {
    // Optimistically reflect the choice; the host echoes a ModeUpdate too.
    dispatch({
      type: HostMessageType.ModeUpdate,
      modes: state.modes,
      activeModeId: modeId,
    });
    postToHost({ type: WebviewMessageType.SelectMode, modeId });
  };

  const createMode = (name: string, systemPrompt?: string): void => {
    postToHost({
      type: WebviewMessageType.CreateMode,
      name,
      ...(systemPrompt ? { systemPrompt } : {}),
    });
  };

  // Plan mode hands off to Build: switch the mode (the SelectMode message is
  // posted before the Submit below, so the host swaps the system prompt first)
  // then kick off the work. The plan itself is already in the transcript.
  const startImplementation = (): void => {
    selectMode(BUILD_MODE_ID);
    sendNow('Go ahead and implement the plan above.', []);
  };

  // Hand the plan off to a file the user can refine: the host writes it to a
  // fresh markdown file, opens it, and switches to Build mode. The user edits,
  // then sends the plan back to implement.
  const editPlan = (plan: string): void => {
    postToHost({ type: WebviewMessageType.EditPlan, content: plan });
  };

  const chatDisabled = !state.activeModel;

  if (state.view === 'sessions' || state.status === ChatStatus.Loading) {
    if (!state.hasConnectedProvider && state.status !== ChatStatus.Loading) {
      return (
        <div className="no-provider-screen">
          <div className="no-provider-content">
            <p className="no-provider-title">No providers connected</p>
            <p className="no-provider-desc">
              Connect a provider to start chatting.
            </p>
            <button
              type="button"
              className="no-provider-btn"
              onClick={connectProvider}
            >
              Connect Providers
            </button>
          </div>
        </div>
      );
    }
    return (
      <SessionsView
        loading={state.status === ChatStatus.Loading}
        sessions={state.sessions}
        activeSessionId={state.activeSessionId}
        onOpen={openSession}
        onRename={renameSession}
        onDelete={deleteSession}
        onClearAll={clearAllSessions}
        onNewSession={newSession}
      />
    );
  }

  if (state.view === 'model-picker') {
    return (
      <ModelPickerView
        models={state.models}
        providerErrors={state.providerErrors}
        activeModel={state.activeModel}
        activeProviderId={state.providerId}
        onSelect={(model) => {
          selectModel(model);
          closeModelPicker();
        }}
        onClose={closeModelPicker}
        onConnectProvider={connectProvider}
        onRefresh={refreshModels}
      />
    );
  }

  // The most recent presented plan (a present_plan tool result). Its card carries
  // the Start/Edit actions — so they attach to a real plan, not to any Plan-mode
  // reply, and stay correct after resuming a session.
  let lastPlanIndex = -1;
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    const m = state.messages[i];
    if (m?.role === WebviewRole.Tool && m.toolName === PRESENT_PLAN_TOOL) {
      lastPlanIndex = i;
      break;
    }
  }

  // The committed transcript carries thinking per assistant step, so each
  // "Thought" block renders inline before its own step (correctly interleaved
  // with the tool cards). `completedThinkingItems` is a fallback for providers
  // whose committed messages don't include thinking at all — using it *as well*
  // would re-render the same segments dumped after the tool calls. So only fall
  // back to it when no committed message already carries thinking.
  const committedMessagesHaveThinking = state.messages.some(
    (message) =>
      message.role === WebviewRole.Assistant && Boolean(message.thinking)
  );

  return (
    <div className="app">
      <div className="chat-header">
        <button
          type="button"
          className="chat-back-btn"
          title={
            state.compacting
              ? 'Compacting — wait for it to finish or stop it first'
              : 'Back to sessions'
          }
          disabled={state.compacting}
          onClick={goBack}
        >
          ← Back
        </button>
        <SessionSwitcher
          title={state.sessionTitle ?? 'New chat'}
          sessions={state.sessions}
          currentSessionId={state.sessionId}
          disabled={state.compacting}
          onOpen={openSession}
          onRename={renameSession}
          onDelete={deleteSession}
          onRefreshSessions={() =>
            postToHost({ type: WebviewMessageType.ListSessions, focus: false })
          }
        />
        <button
          type="button"
          className={`icon-btn ${state.collapseResponses ? 'icon-btn-active' : ''}`}
          title={
            state.collapseResponses
              ? 'Show responses'
              : 'Collapse responses (show only my messages)'
          }
          aria-pressed={state.collapseResponses}
          onClick={toggleCollapseResponses}
        >
          <CollapseIcon size={16} />
        </button>
        <button
          type="button"
          className={`icon-btn ${state.showConversationSidebar ? 'icon-btn-active' : ''}`}
          title={
            state.showConversationSidebar
              ? 'Hide message outline'
              : 'Show message outline'
          }
          aria-pressed={state.showConversationSidebar}
          onClick={toggleConversationSidebar}
        >
          <ChatIcon size={16} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="View chat log (chat.json)"
          onClick={viewChatLog}
        >
          <JsonIcon size={16} />
        </button>
      </div>

      {state.workspaceRoot ? (
        <div className="workspace-dir" title={state.workspaceRoot}>
          {state.workspaceRoot}
        </div>
      ) : null}

      <div className="transcript-wrap">
        <div
          className="transcript"
          ref={transcriptRef}
          onScroll={onTranscriptScroll}
        >
          {/* Single wrapper around everything scrollable so the auto-scroll
              ResizeObserver sees every height change in one place. */}
          <div className="transcript-content" ref={observeTranscriptContent}>
            {/* Persistent notices render in-flow at the top; transient ones
                (auto-compact warnings etc.) use the floating banner below so
                they're visible regardless of scroll position. */}
            {state.notice && !state.noticeTimeoutMs ? (
              <div className="notice">{state.notice}</div>
            ) : null}

            {state.messages.map((message, index) => {
              // Collapse mode: show only the user's own messages so they can scan
              // back through what they asked without the long replies in between.
              if (
                state.collapseResponses &&
                message.role !== WebviewRole.User
              ) {
                return null;
              }
              // A presented plan renders as its own card (markdown + actions)
              // rather than a generic tool row.
              if (
                message.role === WebviewRole.Tool &&
                message.toolName === PRESENT_PLAN_TOOL
              ) {
                return (
                  <PlanCard
                    key={message.id}
                    plan={message.content}
                    showActions={index === lastPlanIndex && !state.busy}
                    onStart={startImplementation}
                    onEdit={() => editPlan(message.content)}
                  />
                );
              }
              const isLastMsg = index === state.messages.length - 1;
              const isLastAssistant =
                !state.busy &&
                isLastMsg &&
                message.role === WebviewRole.Assistant;
              const thinkingItems = selectThinkingItems({
                message,
                isLastAssistant,
                committedMessagesHaveThinking,
                completedThinkingItems: state.completedThinkingItems,
              });
              return (
                <React.Fragment key={message.id}>
                  {thinkingItems.map((item) => (
                    <ThinkingBlock
                      key={item.id}
                      thinking={item.content}
                      durationMs={item.durationMs}
                      collapsed={state.thinkingCollapsed}
                      busy={false}
                    />
                  ))}
                  <MessageView
                    message={message}
                    expandTools={state.expandTools}
                    onOpenFile={openFile}
                    onOpenImage={setPreviewImage}
                    domId={`msg-${message.id}`}
                  />
                </React.Fragment>
              );
            })}

            {(state.collapseResponses ? [] : state.liveTurnItems).map(
              (item) => {
                switch (item.kind) {
                  case LiveTurnItemKind.Thinking:
                    return (
                      <ThinkingBlock
                        key={item.id}
                        thinking={item.content}
                        durationMs={item.durationMs}
                        collapsed={state.thinkingCollapsed}
                        busy={false}
                      />
                    );
                  case LiveTurnItemKind.Message:
                    return (
                      <MessageView
                        key={item.id}
                        message={{
                          id: item.id,
                          role: item.role ?? WebviewRole.Assistant,
                          content: item.content,
                        }}
                        expandTools={state.expandTools}
                      />
                    );
                  case LiveTurnItemKind.Tool: {
                    const tool = state.tools.find(
                      (entry) => entry.toolCallId === item.toolCallId
                    );
                    return tool ? (
                      <ToolActivityView
                        key={item.id}
                        tools={[tool]}
                        expandTools={state.expandTools}
                        onOpenFile={openFile}
                      />
                    ) : null;
                  }
                }
              }
            )}

            {!state.collapseResponses && state.busy && state.thinking ? (
              <ThinkingBlock
                thinking={state.thinking}
                durationMs={state.thinkingDurationMs}
                collapsed={false}
                busy={true}
              />
            ) : null}

            {!state.collapseResponses && state.busy && state.streaming ? (
              <MessageView
                message={{
                  id: 'streaming',
                  role: WebviewRole.Assistant,
                  content: state.streaming,
                }}
                expandTools={state.expandTools}
              />
            ) : null}

            {state.busy &&
            !state.streaming &&
            !state.thinking &&
            !state.approval ? (
              <div className="working">
                Tinkering
                <span className="thinking-spinner" aria-hidden="true" />
              </div>
            ) : null}

            {state.approval ? (
              <ApprovalPrompt
                request={state.approval}
                onRespond={(approved) =>
                  respondApproval(state.approval!.id, approved)
                }
                onApproveAll={() => approveAllTools(state.approval!.id)}
              />
            ) : null}

            {state.input ? (
              <InputPrompt
                request={state.input}
                onRespond={(value) => respondInput(state.input!.id, value)}
              />
            ) : null}

            {state.error ? <div className="error">{state.error}</div> : null}
          </div>
        </div>
        {showJumpToTop ? (
          <button
            type="button"
            className="jump-to-bottom-btn jump-to-top-btn"
            title="Scroll to top"
            aria-label="Scroll to top"
            onClick={jumpToTop}
          >
            <ChevronUpIcon size={16} />
          </button>
        ) : null}
        {showJumpToBottom ? (
          <button
            type="button"
            className="jump-to-bottom-btn"
            title="Scroll to bottom"
            aria-label="Scroll to bottom"
            onClick={jumpToBottom}
          >
            <ChevronDownIcon size={16} />
          </button>
        ) : null}
        {state.showConversationSidebar ? (
          <ConversationSidebar
            messages={state.messages}
            onSelect={scrollToMessage}
            stackedButtons={
              (showJumpToTop ? 1 : 0) + (showJumpToBottom ? 1 : 0)
            }
          />
        ) : null}
        {/* Floating banner pinned above the composer: compaction progress, or
            a transient notice (auto-compact warning, cancellation). Slides in
            and out so it's visible regardless of transcript scroll position. */}
        <FloatingBanner
          show={
            state.compacting || Boolean(state.notice && state.noticeTimeoutMs)
          }
        >
          {state.compacting ? (
            <div className="compact-progress">
              <span className="compact-progress-label">
                Compacting conversation…
                {state.compactPercent !== undefined
                  ? ` ~${state.compactPercent}%`
                  : ''}
                {state.compactTokens
                  ? ` · ${state.compactTokens.toLocaleString()} summary tokens`
                  : ''}
              </span>
              <div className="compact-progress-bar">
                {/* Estimated percent drives a real fill; before the first
                    progress post the bar sweeps indeterminately. */}
                {state.compactPercent !== undefined ? (
                  <div
                    className="compact-progress-fill compact-progress-fill-known"
                    style={{ width: `${state.compactPercent}%` }}
                  />
                ) : (
                  <div className="compact-progress-fill" />
                )}
              </div>
            </div>
          ) : (
            <span>{state.notice}</span>
          )}
        </FloatingBanner>
      </div>

      <ChangesPanel
        files={changedFiles}
        error={state.revertError}
        onKeep={keepFile}
        onUndo={undoFile}
        onKeepAll={keepAllFiles}
        onUndoAll={undoAllFiles}
        onOpenDiff={openDiff}
      />

      {state.queuedMessages.length > 0 ? (
        <div className="queued-messages">
          {state.queuedMessages.map((m) => {
            const editing = editingQueuedId === m.id;
            // Text-only follow-ups steer the running turn at its next step;
            // image-bearing ones can't be folded in, so they wait for the flush.
            const steerable =
              m.images.length === 0 && m.content.trim().length > 0;
            return (
              <div
                key={m.id}
                className="queued-message"
                title={
                  editing
                    ? undefined
                    : steerable
                      ? 'Follow-up — steers the model on its next step'
                      : 'Queued — sends when the current turn finishes'
                }
              >
                <span className="queued-message-icon">
                  {steerable ? '➤' : '⏱'}
                </span>
                {editing ? (
                  <input
                    className="queued-message-input"
                    value={queuedDraft}
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                    onChange={(e) => setQueuedDraft(e.target.value)}
                    onBlur={commitEditQueued}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitEditQueued();
                      }
                      if (e.key === 'Escape') cancelEditQueued();
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="queued-message-text"
                    title="Edit this follow-up"
                    onClick={() => startEditQueued(m.id, m.content)}
                  >
                    {m.content.trim() ||
                      (m.images.length === 1
                        ? '1 image'
                        : `${m.images.length} images`)}
                  </button>
                )}
                {!editing ? (
                  <button
                    type="button"
                    className="queued-message-edit"
                    title="Edit this follow-up"
                    onClick={() => startEditQueued(m.id, m.content)}
                  >
                    <PencilIcon size={16} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="queued-message-remove"
                  title="Cancel this queued message"
                  onClick={() => dequeueMessage(m.id)}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      <Composer
        busy={state.busy}
        // Compaction blocks input entirely: the host would reject a submit
        // mid-compaction anyway, so don't let one be typed-and-lost.
        disabled={chatDisabled || state.compacting}
        models={state.models}
        activeModel={state.activeModel}
        activeProviderId={state.providerId}
        usage={state.usage}
        stats={state.busy && liveStats ? liveStats : state.stats}
        autoApprove={state.autoApprove}
        expandTools={state.expandTools}
        maxReadLines={state.maxReadLines}
        maxHistoryMessages={state.maxHistoryMessages}
        onSubmit={submit}
        onCancel={cancel}
        initialDraft={composerDraftRef.current}
        initialImages={composerDraftImagesRef.current}
        onDraftChange={persistComposerDraft}
        workspaceFiles={state.workspaceFiles}
        fileSymbols={state.fileSymbols}
        onRequestWorkspaceFiles={requestWorkspaceFiles}
        onRequestFileSymbols={requestFileSymbols}
        onNewSession={newSession}
        onOpenModelPicker={openModelPicker}
        onOpenImage={setPreviewImage}
        reasoningEffortByModel={state.reasoningEffortByModel}
        onSetReasoningEffort={setReasoningEffort}
        thinkingCollapsed={state.thinkingCollapsed}
        localModelAutoRefresh={state.localModelAutoRefresh}
        lazyToolLoading={state.lazyToolLoading}
        manageableTools={state.manageableTools}
        disabledTools={state.disabledTools}
        onSetDisabledTools={setDisabledTools}
        onOpenMcpConfig={openMcpConfig}
        onOpenPromptSettings={openPromptSettings}
        mcpLoading={state.mcpLoading}
        modes={state.modes}
        activeModeId={state.activeModeId}
        onSelectMode={selectMode}
        onCreateMode={createMode}
        onToggleAutoApprove={toggleAutoApprove}
        onToggleExpandTools={toggleExpandTools}
        onToggleThinkingCollapsed={toggleThinkingCollapsed}
        onToggleLocalModelAutoRefresh={toggleLocalModelAutoRefresh}
        onToggleLazyToolLoading={toggleLazyToolLoading}
        onSetReadLimit={setReadLimit}
        onSetHistoryLimit={setHistoryLimit}
        autoCompactThresholdPercent={state.autoCompactThresholdPercent}
        onSetAutoCompactThreshold={setAutoCompactThreshold}
        compacting={state.compacting}
        onCompact={compactSession}
      />

      {previewImage ? (
        <div
          className="image-preview-overlay"
          onClick={() => setPreviewImage(null)}
          role="presentation"
        >
          <button
            type="button"
            className="image-preview-close"
            title="Close (Esc)"
            onClick={() => setPreviewImage(null)}
          >
            ×
          </button>
          <img
            className="image-preview-img"
            src={previewImage}
            alt="Image preview"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Renders a presented plan (a present_plan tool result) as its own card: the
 * plan markdown plus, on the most recent plan when idle, the Start/Edit actions.
 */
function PlanCard({
  plan,
  showActions,
  onStart,
  onEdit,
}: {
  plan: string;
  showActions: boolean;
  onStart: () => void;
  onEdit: () => void;
}): React.JSX.Element {
  return (
    <div className="plan-card">
      <div className="plan-card-label">Plan</div>
      <div
        className="plan-card-body markdown-body"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(plan) }}
      />
      {showActions ? (
        <div className="plan-actions">
          <button
            type="button"
            className="plan-start-btn"
            onClick={onStart}
            title="Switch to Build mode and implement this plan"
          >
            Start implementation →
          </button>
          <button
            type="button"
            className="plan-edit-btn"
            onClick={onEdit}
            title="Save the plan to a markdown file to edit before implementing"
          >
            Edit plan
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A banner floated above the composer (bottom of the transcript area), used
 * for compaction progress and transient notices. Slides up on show; on hide it
 * plays a slide-down exit animation before unmounting, keeping a snapshot of
 * its last content so the banner doesn't blank mid-slide (the notice text is
 * usually cleared in the same update that hides it).
 */
function FloatingBanner({
  show,
  children,
}: {
  show: boolean;
  children: React.ReactNode;
}): React.JSX.Element | null {
  const [mounted, setMounted] = React.useState(show);
  const lastChildrenRef = React.useRef<React.ReactNode>(children);
  if (show) lastChildrenRef.current = children;

  React.useEffect(() => {
    if (show) {
      setMounted(true);
      return undefined;
    }
    const id = setTimeout(() => setMounted(false), 250);
    return () => clearTimeout(id);
  }, [show]);

  if (!mounted) return null;
  return (
    <div
      className={`floating-banner ${show ? 'floating-banner-in' : 'floating-banner-out'}`}
    >
      {show ? children : lastChildrenRef.current}
    </div>
  );
}

function ThinkingBlock({
  thinking,
  durationMs,
  collapsed,
  busy,
}: {
  thinking: string;
  durationMs: number;
  collapsed: boolean;
  busy: boolean;
}): React.JSX.Element {
  const label = busy
    ? 'Thinking'
    : durationMs > 0
      ? `Thought for ${formatDuration(durationMs)}`
      : 'Thought';

  if (busy) {
    return (
      <div className="thinking">
        <div className="thinking-label thinking-label-busy">
          {label}
          <span className="thinking-spinner" aria-hidden="true" />
        </div>
        <div
          className="thinking-content markdown-body"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(thinking) }}
        />
      </div>
    );
  }

  return (
    <details className="thinking thinking-done" open={!collapsed}>
      <summary className="thinking-label">{label}</summary>
      <div
        className="thinking-content markdown-body"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(thinking) }}
      />
    </details>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${Math.round(s * 10) / 10}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}
