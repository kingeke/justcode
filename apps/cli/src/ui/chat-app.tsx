import React, { startTransition, useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';

import type {
  ChatSessionService,
  StartSessionResult,
} from '@core/application/chat-session-service';
import type { Conversation } from '@core/domain/conversation';
import type { ProviderId } from '@core/ports/chat-model';

interface ChatAppProps {
  providerId: ProviderId;
  chatSessionService: ChatSessionService;
  sessionId: string;
  requestedModel: string | undefined;
}

export function ChatApp(props: ChatAppProps): React.ReactElement {
  const { exit } = useApp();
  const [session, setSession] = useState<StartSessionResult | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<string>('Loading session...');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useInput((value, key) => {
    if (key.escape || (key.ctrl && value.toLowerCase() === 'c')) {
      exit();
    }
  });

  useEffect(() => {
    void props.chatSessionService
      .startSession(
        props.requestedModel
          ? {
              sessionId: props.sessionId,
              requestedModel: props.requestedModel,
            }
          : {
              sessionId: props.sessionId,
            }
      )
      .then((startedSession) => {
        startTransition(() => {
          setSession(startedSession);
          setConversation(startedSession.conversation);
          setStatus('Ready');
        });
      })
      .catch((caughtError: unknown) => {
        setError(getErrorMessage(caughtError));
        setStatus('Failed to start session');
      });
  }, [props.chatSessionService, props.requestedModel, props.sessionId]);

  const submit = async (value: string): Promise<void> => {
    if (!conversation || !session || isSending || !value.trim()) {
      return;
    }

    setError(null);
    setIsSending(true);
    setInput('');
    setStatus('Waiting for response...');

    try {
      const result = await props.chatSessionService.submitMessage({
        conversation,
        model: session.activeModel,
        content: value,
      });

      startTransition(() => {
        setConversation(result.conversation);
        setStatus('Ready');
      });
    } catch (caughtError: unknown) {
      setError(getErrorMessage(caughtError));
      setStatus('Request failed');
    } finally {
      setIsSending(false);
    }
  };

  const modelsLine = session?.availableModels.length
    ? session.availableModels.map((model) => model.id).join(', ')
    : 'No models detected';

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan">justcode</Text>
      <Text>
        provider: {props.providerId} | session: {props.sessionId} | model:{' '}
        {session?.activeModel ?? 'loading'}
      </Text>
      <Text dimColor>available models: {modelsLine}</Text>
      <Text dimColor>press Enter to send, Esc or Ctrl+C to exit</Text>
      <Box marginTop={1} flexDirection="column">
        {conversation?.messages.length ? (
          conversation.messages.map((message) => (
            <Text key={message.id}>
              <Text
                color={
                  message.role === 'user'
                    ? 'green'
                    : message.role === 'assistant'
                      ? 'magenta'
                      : 'yellow'
                }
              >
                {message.role}
              </Text>
              <Text>: {message.content}</Text>
            </Text>
          ))
        ) : (
          <Text dimColor>No messages yet.</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Text>{isSending ? 'sending' : 'prompt'}&gt; </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={submit}
          focus={!isSending}
        />
      </Box>
      <Box marginTop={1}>
        {isSending ? (
          <Text color="yellow">
            <Spinner type="dots" /> Thinking...
          </Text>
        ) : (
          <Text dimColor>{status}</Text>
        )}
      </Box>
      {error ? (
        <Box marginTop={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}
