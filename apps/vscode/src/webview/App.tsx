import * as React from 'react';

import { APP_NAME } from '@core/branding';
import {
  WebviewMessageType,
  WebviewRole,
} from '@ext/shared/protocol';
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

  // Subscribe to host messages once, and ask for the initial snapshot.
  React.useEffect(() => {
    const unsubscribe = onHostMessage(dispatch);
    postToHost({ type: WebviewMessageType.Init });
    return unsubscribe;
  }, []);

  // Keep the latest content in view as tokens stream and messages arrive.
  React.useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages, state.streaming, state.thinking, state.tools]);

  const submit = (content: string): void => {
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

  const selectModel = (modelId: string): void => {
    dispatch({ type: LocalActionType.SelectModel, modelId });
    postToHost({ type: WebviewMessageType.SelectModel, modelId });
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

  const openModelPicker = (): void => {
    dispatch({ type: LocalActionType.SetView, view: 'model-picker' });
  };

  const closeModelPicker = (): void => {
    dispatch({ type: LocalActionType.SetView, view: 'chat' });
  };

  const connectProvider = (): void => {
    postToHost({ type: WebviewMessageType.ConnectProvider });
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
        onNewSession={newSession}
      />
    );
  }

  if (state.view === 'model-picker') {
    return (
      <ModelPickerView
        models={state.models}
        activeModel={state.activeModel}
        onSelect={(modelId) => {
          selectModel(modelId);
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
        <span className="chat-title">
          {state.sessionTitle ?? 'New chat'}
        </span>
      </div>

      <div className="transcript" ref={transcriptRef}>
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

        {state.busy && !state.streaming && !state.thinking && !state.approval ? (
          <div className="working">{APP_NAME} is working…</div>
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
        usage={state.usage}
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
