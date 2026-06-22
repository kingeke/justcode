import React, { startTransition, useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';

import {
  applyMentionSuggestion,
  filterMentionSuggestions,
  getActiveMentionQuery,
  type PromptAttachmentService,
} from '@core/application/prompt-attachment-service';
import type {
  ChatSessionService,
  StartSessionResult,
} from '@core/application/chat-session-service';
import type { Conversation } from '@core/domain/conversation';
import type { ProviderId } from '@core/ports/chat-model';

interface ChatAppProps {
  providerId: ProviderId;
  chatSessionService: ChatSessionService;
  promptAttachmentService: PromptAttachmentService;
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
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);

  const activeMentionQuery = useMemo(
    () => getActiveMentionQuery(input),
    [input]
  );
  const mentionSuggestions = useMemo(
    () => filterMentionSuggestions(workspaceFiles, activeMentionQuery),
    [activeMentionQuery, workspaceFiles]
  );
  const selectedSuggestion =
    mentionSuggestions[selectedSuggestionIndex] ?? mentionSuggestions[0];

  useInput((value, key) => {
    if (key.escape || (key.ctrl && value.toLowerCase() === 'c')) {
      exit();
      return;
    }

    if (!mentionSuggestions.length) {
      return;
    }

    if (key.downArrow) {
      setSelectedSuggestionIndex((currentIndex) =>
        Math.min(currentIndex + 1, mentionSuggestions.length - 1)
      );
      return;
    }

    if (key.upArrow) {
      setSelectedSuggestionIndex((currentIndex) =>
        Math.max(currentIndex - 1, 0)
      );
      return;
    }

    if (key.tab) {
      if (!selectedSuggestion) {
        return;
      }

      setInput((currentInput) =>
        applyMentionSuggestion(currentInput, selectedSuggestion)
      );
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

  useEffect(() => {
    void props.promptAttachmentService
      .listFiles()
      .then((files) => {
        startTransition(() => {
          setWorkspaceFiles(files);
        });
      })
      .catch((caughtError: unknown) => {
        setError(getErrorMessage(caughtError));
      });
  }, [props.promptAttachmentService]);

  useEffect(() => {
    setSelectedSuggestionIndex(0);
  }, [activeMentionQuery]);

  const submit = async (value: string): Promise<void> => {
    if (!conversation || !session || isSending || !value.trim()) {
      return;
    }

    setError(null);
    setIsSending(true);
    setInput('');
    setStatus('Waiting for response...');

    try {
      const attachments =
        await props.promptAttachmentService.resolveAttachments(value);
      const result = await props.chatSessionService.submitMessage({
        conversation,
        model: session.activeModel,
        content: value,
        attachments,
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
      <Text dimColor>
        press Enter to send, Tab to complete @file, Esc or Ctrl+C to exit
      </Text>
      <Box marginTop={1} flexDirection="column">
        {conversation?.messages.length ? (
          conversation.messages.map((message) => (
            <Box key={message.id} flexDirection="column">
              <Text>
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
              {message.attachments?.map((attachment) => (
                <Text key={`${message.id}:${attachment.path}`} dimColor>
                  attached: @{attachment.path}
                </Text>
              ))}
            </Box>
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
      {mentionSuggestions.length ? (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>file suggestions:</Text>
          {mentionSuggestions.map((suggestion, index) => (
            <Text
              key={suggestion}
              {...(index === selectedSuggestionIndex ? { color: 'cyan' } : {})}
            >
              {index === selectedSuggestionIndex ? '>' : ' '} @{suggestion}
            </Text>
          ))}
        </Box>
      ) : null}
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
