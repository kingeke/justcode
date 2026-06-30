import * as React from 'react';

import { APP_NAME } from '@core/branding';
import {
  WebviewMessageType,
  WebviewRole,
  type WebviewModel,
  type WebviewReasoningChoice,
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
import { ToolActivityView } from '@ext/webview/components/ToolActivityView';
import { ApprovalPrompt, InputPrompt } from '@ext/webview/components/Prompts';
import { Composer } from '@ext/webview/components/Composer';
import { SessionsView } from '@ext/webview/components/SessionsView';
import { ModelPickerView } from '@ext/webview/components/ModelPickerView';
import { ChangesPanel } from '@ext/webview/components/ChangesPanel';
import { deriveChangedFiles, type ChangedFile } from '@ext/webview/changes';

export function App(): React.JSX.Element {
  const [state, dispatch] = React.useReducer(reducer, initialState);
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

  // Track whether the user is pinned to the bottom. A small threshold absorbs
  // sub-pixel rounding and the height growth from a token that lands between the
  // scroll event and this read.
  const onTranscriptScroll = (): void => {
    const el = transcriptRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom <= 24;
  };

  // Keep the latest content in view as tokens stream and messages arrive — but
  // only while the user hasn't scrolled up to read earlier output.
  React.useEffect(() => {
    const el = transcriptRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [state.messages, state.streaming, state.thinking, state.tools]);

  const submit = (content: string): void => {
    // Sending a new message should always snap to it, even if the user had
    // scrolled up while reading the previous turn.
    stickToBottomRef.current = true;
    dispatch({ type: LocalActionType.OptimisticSubmit, content });
    postToHost({ type: WebviewMessageType.Submit, content });
  };

  const cancel = (): void => {
    postToHost({ type: WebviewMessageType.Cancel });
  };

  const respondApproval = (id: string, approved: boolean): void => {
    postToHost({ type: WebviewMessageType.ApprovalResponse, id, approved });
    dispatch({ type: LocalActionType.DismissApproval });
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

  const selectProvider = (providerId: string): void => {
    postToHost({ type: WebviewMessageType.SelectProvider, providerId });
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

  const toggleAutoWrites = (): void => {
    dispatch({ type: LocalActionType.ToggleAutoWrites });
    postToHost({ type: WebviewMessageType.ToggleAutoWrites });
  };

  const toggleExpandTools = (): void => {
    dispatch({ type: LocalActionType.ToggleExpandTools });
    postToHost({ type: WebviewMessageType.ToggleExpandTools });
  };

  const toggleThinkingCollapsed = (): void => {
    dispatch({ type: LocalActionType.ToggleThinkingCollapsed });
    postToHost({ type: WebviewMessageType.ToggleThinkingCollapsed });
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
    () => deriveChangedFiles(state.messages, state.tools, resolvedMap),
    [state.messages, state.tools, resolvedMap]
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
        activeModel={state.activeModel}
        activeProviderId={state.providerId}
        onSelect={(model) => {
          selectModel(model);
          closeModelPicker();
        }}
        onClose={closeModelPicker}
        onConnectProvider={connectProvider}
      />
    );
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
      </div>

      <div
        className="transcript"
        ref={transcriptRef}
        onScroll={onTranscriptScroll}
      >
        {state.notice ? <div className="notice">{state.notice}</div> : null}

        {state.messages.map((message, index) => {
          const isLastMsg = index === state.messages.length - 1;
          const isLastAssistant =
            !state.busy && isLastMsg && message.role === WebviewRole.Assistant;
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
              />
            </React.Fragment>
          );
        })}

        {state.liveTurnItems.map((item) => {
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

        {state.busy && state.thinking ? (
          <ThinkingBlock
            thinking={state.thinking}
            durationMs={state.thinkingDurationMs}
            collapsed={false}
            busy={true}
          />
        ) : null}

        {state.busy && state.streaming ? (
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

      <ChangesPanel
        files={changedFiles}
        error={state.revertError}
        onKeep={keepFile}
        onUndo={undoFile}
        onKeepAll={keepAllFiles}
        onUndoAll={undoAllFiles}
        onOpenFile={openFile}
      />

      <Composer
        busy={state.busy}
        disabled={chatDisabled}
        models={state.models}
        activeModel={state.activeModel}
        activeProviderId={state.providerId}
        usage={state.usage}
        stats={state.stats}
        autoApplyWrites={state.autoApplyWrites}
        expandTools={state.expandTools}
        maxReadLines={state.maxReadLines}
        maxHistoryMessages={state.maxHistoryMessages}
        onSubmit={submit}
        onCancel={cancel}
        onNewSession={newSession}
        onOpenModelPicker={openModelPicker}
        reasoningEffortByModel={state.reasoningEffortByModel}
        onSetReasoningEffort={setReasoningEffort}
        thinkingCollapsed={state.thinkingCollapsed}
        onToggleAutoWrites={toggleAutoWrites}
        onToggleExpandTools={toggleExpandTools}
        onToggleThinkingCollapsed={toggleThinkingCollapsed}
        onSetReadLimit={setReadLimit}
        onSetHistoryLimit={setHistoryLimit}
      />
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
        <pre className="thinking-content">{thinking}</pre>
      </div>
    );
  }

  return (
    <details className="thinking thinking-done" open={!collapsed}>
      <summary className="thinking-label">{label}</summary>
      <pre className="thinking-content">{thinking}</pre>
    </details>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${Math.round(s * 10) / 10}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}
