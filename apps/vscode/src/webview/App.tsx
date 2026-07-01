import * as React from 'react';

import {
  HostMessageType,
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
import { ModelPickerView } from '@ext/webview/components/ModelPickerView';
import {
  ChevronDownIcon,
  CollapseIcon,
  JsonIcon,
  PencilIcon,
} from '@ext/webview/components/Icons';
import { ChangesPanel } from '@ext/webview/components/ChangesPanel';
import { deriveChangedFiles, type ChangedFile } from '@ext/webview/changes';
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
  // length and the time since the first token, refreshed on a timer.
  const turnStartRef = React.useRef<number | null>(null);
  const firstTokenRef = React.useRef<number | null>(null);
  const [statsTick, setStatsTick] = React.useState(0);

  React.useEffect(() => {
    if (!state.busy) {
      turnStartRef.current = null;
      firstTokenRef.current = null;
      return undefined;
    }
    if (turnStartRef.current === null) turnStartRef.current = Date.now();
    const id = setInterval(() => setStatsTick((t) => t + 1), 150);
    return () => clearInterval(id);
  }, [state.busy]);

  // Stamp the first-token time as soon as any output (thinking or answer) lands.
  if (
    state.busy &&
    firstTokenRef.current === null &&
    (state.streaming || state.thinking)
  ) {
    firstTokenRef.current = Date.now();
  }

  const liveStats = React.useMemo<WebviewStats | undefined>(() => {
    if (!state.busy || turnStartRef.current === null) return undefined;
    const now = Date.now();
    const firstToken = firstTokenRef.current ?? now;
    const ttftMs = Math.max(firstToken - turnStartRef.current, 0);
    const genElapsedMs = Math.max(now - firstToken, 1);
    // Count the whole turn's output, not just the visible buffers: once the
    // first answer token lands, thinking is flushed out of `state.thinking` into
    // `liveTurnItems`, so summing only thinking+streaming would collapse the
    // count mid-turn (rate drops to ~0, then climbs). Include committed
    // thinking/message items so the total only grows.
    const committed = state.liveTurnItems.reduce(
      (sum, item) =>
        item.kind === LiveTurnItemKind.Thinking ||
        item.kind === LiveTurnItemKind.Message
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
    // statsTick drives the periodic refresh; the ref reads are intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.busy,
    state.streaming,
    state.thinking,
    state.liveTurnItems,
    state.stats,
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

  const onTranscriptScroll = (): void => {
    const el = transcriptRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom <= 24;
    // A larger threshold than the auto-scroll pin so the button doesn't flicker
    // in and out on the last sliver of scroll.
    setShowJumpToBottom(distanceFromBottom > 120);
  };

  const jumpToBottom = (): void => {
    const el = transcriptRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickToBottomRef.current = true;
    setShowJumpToBottom(false);
  };

  // Keep the latest content in view as tokens stream and messages arrive — but
  // only while the user hasn't scrolled up to read earlier output.
  React.useEffect(() => {
    const el = transcriptRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [state.messages, state.streaming, state.thinking, state.tools]);

  // When an approval/input gate appears it needs the user to act, so reveal it
  // unconditionally — even if they'd scrolled up — and re-arm auto-scroll. The
  // gate's diff/preview can grow the transcript after this commit, so scroll on
  // the next frame (post-paint) and pin to the real bottom rather than the
  // height measured mid-render.
  React.useEffect(() => {
    if (!state.approval && !state.input) return;
    const el = transcriptRef.current;
    if (!el) return;
    const reveal = (): void => {
      el.scrollTop = el.scrollHeight;
      stickToBottomRef.current = true;
    };
    reveal();
    const raf = requestAnimationFrame(reveal);
    return () => cancelAnimationFrame(raf);
  }, [state.approval, state.input]);

  const sendNow = (content: string, images: WebviewImage[]): void => {
    // Sending a new message should always snap to it, even if the user had
    // scrolled up while reading the previous turn.
    stickToBottomRef.current = true;
    dispatch({ type: LocalActionType.OptimisticSubmit, content, images });
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
    postToHost({ type: WebviewMessageType.NewSession });
  };

  const goBack = (): void => {
    postToHost({ type: WebviewMessageType.ListSessions });
  };

  const openSession = (sessionId: string): void => {
    postToHost({ type: WebviewMessageType.OpenSession, sessionId });
  };

  const deleteSession = (sessionId: string): void => {
    // The host shows a native confirmation dialog before removing anything.
    postToHost({ type: WebviewMessageType.DeleteSession, sessionId });
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

  const closeModelPicker = (): void => {
    dispatch({ type: LocalActionType.SetView, view: 'chat' });
  };

  const connectProvider = (): void => {
    // Connecting (including OAuth sign-in) happens inline in the Settings tab;
    // reveal it rather than shelling out to the CLI in a terminal.
    postToHost({ type: WebviewMessageType.OpenSettings });
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

  const openMcpConfig = (): void => {
    postToHost({ type: WebviewMessageType.OpenMcpConfig });
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
              onClick={openSettings}
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
        onOpen={openSession}
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
    if (m.role === WebviewRole.Tool && m.toolName === PRESENT_PLAN_TOOL) {
      lastPlanIndex = i;
      break;
    }
  }

  return (
    <div className="app">
      <div className="chat-header">
        <button
          type="button"
          className="chat-back-btn"
          title="Back to sessions"
          onClick={goBack}
        >
          ← Back
        </button>
        <span className="chat-title">{state.sessionTitle ?? 'New chat'}</span>
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
          className="icon-btn"
          title="View chat log (chat.json)"
          onClick={viewChatLog}
        >
          <JsonIcon size={16} />
        </button>
      </div>

      <div className="transcript-wrap">
        <div
          className="transcript"
          ref={transcriptRef}
          onScroll={onTranscriptScroll}
        >
          {state.notice ? <div className="notice">{state.notice}</div> : null}

          {state.messages.map((message, index) => {
            // Collapse mode: show only the user's own messages so they can scan
            // back through what they asked without the long replies in between.
            if (state.collapseResponses && message.role !== WebviewRole.User) {
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
            const thinkingItems =
              message.role === WebviewRole.Assistant && message.thinking
                ? [
                    {
                      id: `${message.id}-thinking`,
                      content: message.thinking.content,
                      durationMs: message.thinking.durationMs,
                    },
                  ]
                : isLastAssistant
                  ? state.completedThinkingItems
                  : [];
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
                />
              </React.Fragment>
            );
          })}

          {(state.collapseResponses ? [] : state.liveTurnItems).map((item) => {
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
                      role: WebviewRole.Assistant,
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
          })}

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
            <div className="working">Tinkering…</div>
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
      </div>

      <ChangesPanel
        files={changedFiles}
        error={state.revertError}
        onKeep={keepFile}
        onUndo={undoFile}
        onKeepAll={keepAllFiles}
        onUndoAll={undoAllFiles}
        onOpenFile={openFile}
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
        disabled={chatDisabled}
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
    ? 'Thinking…'
    : durationMs > 0
      ? `Thought for ${formatDuration(durationMs)}`
      : 'Thought';

  if (busy) {
    return (
      <div className="thinking">
        <div className="thinking-label">{label}</div>
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
