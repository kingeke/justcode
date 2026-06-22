import React, { startTransition, useEffect, useMemo, useRef, useState } from 'react';
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
import type { ModelInfo, ProviderId } from '@core/ports/chat-model';
import { renderMarkdown } from './render-markdown.js';
import { filterCommands, parseCommandInput } from './commands.js';

const MAX_COMMAND_ITEMS = 5;

interface ChatAppProps {
  providerId: ProviderId;
  chatSessionService: ChatSessionService;
  promptAttachmentService: PromptAttachmentService;
  sessionId: string;
  requestedModel: string | undefined;
}

export function ChatApp(props: ChatAppProps): React.ReactElement {
  const { exit } = useApp();
  const [currentSessionId, setCurrentSessionId] = useState(props.sessionId);
  const [session, setSession] = useState<StartSessionResult | null>(null);
  const [activeModelInfo, setActiveModelInfo] = useState<ModelInfo | null>(null);
  const [metrics, setMetrics] = useState({
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    cost: 0,
    lastInputTokens: 0,
  });
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<string>('Loading session...');
  const [isSending, setIsSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string>('');
  const streamingBufferRef = useRef('');
  const [error, setError] = useState<string | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);

  const isCommandMode = input.startsWith('/') && !input.includes(' ');
  const commandQuery = isCommandMode ? parseCommandInput(input) ?? '' : '';
  const filteredCommands = useMemo(
    () => (isCommandMode ? filterCommands(commandQuery) : []),
    [isCommandMode, commandQuery]
  );
  const visibleCommands = filteredCommands.slice(0, MAX_COMMAND_ITEMS);

  const activeMentionQuery = useMemo(
    () => (isCommandMode ? null : getActiveMentionQuery(input)),
    [isCommandMode, input]
  );
  const mentionSuggestions = useMemo(
    () => filterMentionSuggestions(workspaceFiles, activeMentionQuery ?? undefined),
    [activeMentionQuery, workspaceFiles]
  );
  const selectedSuggestion =
    mentionSuggestions[selectedSuggestionIndex] ?? mentionSuggestions[0];

  useInput((value, key) => {
    if (key.escape || (key.ctrl && value.toLowerCase() === 'c')) {
      exit();
      return;
    }

    if (isCommandMode && visibleCommands.length) {
      if (key.downArrow) {
        setSelectedCommandIndex((i) =>
          Math.min(i + 1, visibleCommands.length - 1)
        );
        return;
      }
      if (key.upArrow) {
        setSelectedCommandIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (key.tab) {
        const cmd = visibleCommands[selectedCommandIndex];
        if (cmd) setInput(`/${cmd.name}`);
        return;
      }
      return;
    }

    if (!mentionSuggestions.length) return;

    if (key.downArrow) {
      setSelectedSuggestionIndex((i) =>
        Math.min(i + 1, mentionSuggestions.length - 1)
      );
      return;
    }
    if (key.upArrow) {
      setSelectedSuggestionIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (key.tab) {
      if (selectedSuggestion) {
        setInput((cur) => applyMentionSuggestion(cur, selectedSuggestion));
      }
    }
  });

  useEffect(() => {
    setSelectedCommandIndex(0);
  }, [commandQuery]);

  useEffect(() => {
    setSelectedSuggestionIndex(0);
  }, [activeMentionQuery]);

  const loadSession = (sessionId: string): void => {
    setStatus('Loading session...');
    setSession(null);
    setConversation(null);
    setActiveModelInfo(null);
    setMetrics({ inputTokens: 0, outputTokens: 0, cachedTokens: 0, cost: 0, lastInputTokens: 0 });
    void props.chatSessionService
      .startSession(
        props.requestedModel
          ? { sessionId, requestedModel: props.requestedModel }
          : { sessionId }
      )
      .then((startedSession) => {
        const modelInfo =
          startedSession.availableModels.find(
            (m) => m.id === startedSession.activeModel
          ) ?? null;
        startTransition(() => {
          setSession(startedSession);
          setConversation(startedSession.conversation);
          setActiveModelInfo(modelInfo);
          setStatus('Ready');
        });
      })
      .catch((caughtError: unknown) => {
        setError(getErrorMessage(caughtError));
        setStatus('Failed to start session');
      });
  };

  useEffect(() => {
    loadSession(currentSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId]);

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

  const executeCommand = (name: string): void => {
    setInput('');
    setError(null);

    if (name === 'new-session') {
      const newId = `session-${Date.now()}`;
      setCurrentSessionId(newId);
    }

    if (name === 'clear') {
      void props.chatSessionService
        .clearSession(currentSessionId)
        .then((fresh) => {
          startTransition(() => {
            setConversation(fresh);
            setStatus('Ready');
          });
        })
        .catch((caughtError: unknown) => {
          setError(getErrorMessage(caughtError));
        });
    }
  };

  const submit = async (value: string): Promise<void> => {
    if (isSending || !value.trim()) return;

    if (isCommandMode) {
      const query = parseCommandInput(value) ?? '';
      const exact = filteredCommands.find((c) => c.name === query);
      const selected = exact ?? visibleCommands[selectedCommandIndex];
      if (selected) {
        executeCommand(selected.name);
      }
      setInput('');
      return;
    }

    if (!conversation || !session) return;

    setError(null);
    setIsSending(true);
    setStreamingContent('');
    streamingBufferRef.current = '';
    setInput('');
    setStatus('Waiting for response...');

    const flushInterval = setInterval(() => {
      const buffered = streamingBufferRef.current;
      if (buffered) {
        setStreamingContent(buffered);
      }
    }, 50);

    try {
      const attachments =
        await props.promptAttachmentService.resolveAttachments(value);
      const result = await props.chatSessionService.submitMessage({
        conversation,
        model: session.activeModel,
        content: value,
        attachments,
        onToken: (token) => {
          streamingBufferRef.current += token;
        },
      });

      clearInterval(flushInterval);
      startTransition(() => {
        streamingBufferRef.current = '';
        setStreamingContent('');
        setConversation(result.conversation);
        setStatus('Ready');
        if (result.usage) {
          const u = result.usage;
          const pricing = activeModelInfo?.pricing;
          const requestCost = pricing
            ? u.inputTokens * pricing.inputPerToken +
              u.outputTokens * pricing.outputPerToken +
              u.cachedTokens * (pricing.cacheReadPerToken ?? pricing.inputPerToken)
            : 0;
          setMetrics((prev) => ({
            inputTokens: prev.inputTokens + u.inputTokens,
            outputTokens: prev.outputTokens + u.outputTokens,
            cachedTokens: prev.cachedTokens + u.cachedTokens,
            cost: prev.cost + requestCost,
            lastInputTokens: u.inputTokens,
          }));
        }
      });
    } catch (caughtError: unknown) {
      clearInterval(flushInterval);
      streamingBufferRef.current = '';
      setStreamingContent('');
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
        provider: {props.providerId} | session: {currentSessionId} | model:{' '}
        {session?.activeModel ?? 'loading'}
      </Text>
      <Text dimColor>available models: {modelsLine}</Text>
      <Text dimColor>
        press Enter to send, Tab to complete @file or /command, Esc or Ctrl+C to exit
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
                <Text>
                  :{' '}
                  {message.role === 'assistant'
                    ? renderMarkdown(message.content)
                    : message.content}
                </Text>
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
        {streamingContent ? (
          <Box flexDirection="column">
            <Text>
              <Text color="magenta">assistant</Text>
              <Text>: {renderMarkdown(streamingContent)}</Text>
            </Text>
          </Box>
        ) : null}
      </Box>

      {isCommandMode && visibleCommands.length ? (
        <Box
          marginTop={1}
          flexDirection="column"
          borderStyle="single"
          borderColor="cyan"
          paddingX={1}
        >
          <Text dimColor>commands</Text>
          {visibleCommands.map((cmd, index) => (
            <Box key={cmd.name}>
              <Text {...(index === selectedCommandIndex ? { color: 'cyan' } : {})}>
                {index === selectedCommandIndex ? '›' : ' '}{' '}
                <Text bold={index === selectedCommandIndex}>/{cmd.name}</Text>
                {'  '}
                <Text dimColor>{cmd.description}</Text>
              </Text>
            </Box>
          ))}
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text>{isSending ? 'sending' : 'prompt'}&gt; </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={submit}
          focus={!isSending}
        />
      </Box>

      {!isCommandMode && mentionSuggestions.length ? (
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

      <Box marginTop={1} justifyContent="space-between">
        <Box>
          {isSending ? (
            <Text color="yellow">
              <Spinner type="dots" />{' '}
            </Text>
          ) : null}
          <Text color="cyan" bold>
            {session?.activeModel ?? 'loading'}
          </Text>
        </Box>
        <Box gap={2}>
          {metrics.inputTokens > 0 ? (
            <>
              <Text dimColor>
                in <Text color="white">{metrics.inputTokens.toLocaleString()}</Text>
              </Text>
              <Text dimColor>
                out <Text color="white">{metrics.outputTokens.toLocaleString()}</Text>
              </Text>
              {metrics.cachedTokens > 0 ? (
                <Text dimColor>
                  cached <Text color="white">{metrics.cachedTokens.toLocaleString()}</Text>
                </Text>
              ) : null}
              {activeModelInfo?.contextWindow ? (
                <Text dimColor>
                  ctx{' '}
                  <Text color={contextPct(metrics.lastInputTokens, activeModelInfo.contextWindow) > 80 ? 'yellow' : 'white'}>
                    {contextPct(metrics.lastInputTokens, activeModelInfo.contextWindow)}%
                  </Text>
                </Text>
              ) : null}
              {metrics.cost > 0 ? (
                <Text dimColor>
                  $<Text color="white">{metrics.cost.toFixed(4)}</Text>
                </Text>
              ) : null}
            </>
          ) : (
            <Text dimColor>{status}</Text>
          )}
        </Box>
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

function contextPct(inputTokens: number, contextWindow: number): number {
  return Math.round((inputTokens / contextWindow) * 100);
}
