import * as React from 'react';

import { APP_NAME } from '@core/branding';
import {
  WebviewMessageType,
  WebviewRole,
  type WebviewModel,
} from '@ext/shared/protocol';
import { CogIcon } from '@ext/webview/components/Icons';
import { onHostMessage, postToHost } from '@ext/webview/vscode-api';
import {
  ChatStatus,
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
    postToHost({ type: WebviewMessageType.ConnectProvider });
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

  const setReadLimit = (lines: number): void => {
    dispatch({ type: LocalActionType.SetReadLimit, lines });
    postToHost({ type: WebviewMessageType.SetReadLimit, lines });
  };

  const chatDisabled = !state.activeModel;

  if (state.view === 'sessions' || state.status === ChatStatus.Loading) {
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
        <button
          type="button"
          className="icon-btn chat-settings-btn"
          title="Settings"
          aria-label="Settings"
          onClick={openSettings}
        >
          <CogIcon size={15} />
        </button>
      </div>

      <div
        className="transcript"
        ref={transcriptRef}
        onScroll={onTranscriptScroll}
      >
        {state.notice ? <div className="notice">{state.notice}</div> : null}

        {state.messages.map((message) => (
          <MessageView key={message.id} message={message} />
        ))}

        {state.busy && state.thinking ? (
          <div className="thinking">
            <div className="thinking-label">Thinking</div>
            <pre className="thinking-content">{state.thinking}</pre>
          </div>
        ) : null}

        <ToolActivityView tools={state.tools} expandTools={state.expandTools} />

        {state.busy && state.streaming ? (
          <MessageView
            message={{
              id: 'streaming',
              role: WebviewRole.Assistant,
              content: state.streaming,
            }}
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
        onSubmit={submit}
        onCancel={cancel}
        onNewSession={newSession}
        onOpenModelPicker={openModelPicker}
        onToggleAutoWrites={toggleAutoWrites}
        onToggleExpandTools={toggleExpandTools}
        onSetReadLimit={setReadLimit}
      />
    </div>
  );
}
