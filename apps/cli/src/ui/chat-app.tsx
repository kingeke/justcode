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
import { createMessage } from '@core/domain/message';
import type { ModelInfo, ProviderId, ProviderClient } from '@core/ports/chat-model';
import { renderMarkdown } from './render-markdown.js';
import { filterCommands, parseCommandInput } from './commands.js';
import { ModelPicker } from './model-picker.js';

const MAX_COMMAND_ITEMS = 5;

interface ChatAppProps {
  providerId: ProviderId;
  chatSessionService: ChatSessionService;
  promptAttachmentService: PromptAttachmentService;
  sessionId: string;
  requestedModel: string | undefined;
  allProviders: ProviderClient[];
  createProvider: (id: ProviderId) => ProviderClient;
  onModelChange?: (modelId: string, providerId: string) => void;
  initialThinkingCollapsed?: boolean;
  onThinkingCollapsedChange?: (collapsed: boolean) => void;
}

export function ChatApp(props: ChatAppProps): React.ReactElement {
  const { exit } = useApp();
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [allModels, setAllModels] = useState<ModelInfo[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState(props.sessionId);
  const [session, setSession] = useState<StartSessionResult | null>(null);
  const [activeModel, setActiveModel] = useState<string>('');
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
  const [streamingThinking, setStreamingThinking] = useState<string>('');
  const [thinkingDuration, setThinkingDuration] = useState<number | null>(null);
  const thinkingRef = useRef<{ buffer: string; startMs: number; durationMs: number | null }>({
    buffer: '',
    startMs: 0,
    durationMs: null,
  });
  const [messageThinking, setMessageThinking] = useState<
    Record<string, { content: string; durationMs: number }>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [thinkingCollapsed, setThinkingCollapsed] = useState(
    props.initialThinkingCollapsed ?? false
  );

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
    if (showModelPicker) return;

    if (key.escape || (key.ctrl && value.toLowerCase() === 'c')) {
      exit();
      return;
    }

    if (isCommandMode && visibleCommands.length) {
      if (key.downArrow) {
        setSelectedCommandIndex((i) => Math.min(i + 1, visibleCommands.length - 1));
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
      setSelectedSuggestionIndex((i) => Math.min(i + 1, mentionSuggestions.length - 1));
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
          setActiveModel(startedSession.activeModel);
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
        startTransition(() => setWorkspaceFiles(files));
      })
      .catch((caughtError: unknown) => {
        setError(getErrorMessage(caughtError));
      });
  }, [props.promptAttachmentService]);

  useEffect(() => {
    void Promise.allSettled(props.allProviders.map((p) => p.listModels())).then(
      (results) => {
        const models = results
          .filter((r) => r.status === 'fulfilled')
          .flatMap((r) => r.value);
        startTransition(() => setAllModels(models));
      }
    );
  }, [props.allProviders]);

  const handleModelSelect = (model: ModelInfo): void => {
    setShowModelPicker(false);
    if (model.providerId !== props.chatSessionService['provider']?.providerId) {
      try {
        const newProvider = props.createProvider(model.providerId);
        props.chatSessionService.switchProvider(newProvider);
      } catch (e) {
        setError(getErrorMessage(e));
        return;
      }
    }
    setActiveModel(model.id);
    setActiveModelInfo(model);
    setStatus(`Switched to ${model.displayName}`);
    props.onModelChange?.(model.id, model.providerId);
  };

  const executeCommand = (name: string): void => {
    setInput('');
    setError(null);

    if (name === 'models') {
      setShowModelPicker(true);
      return;
    }

    if (name === 'thinking') {
      const next = !thinkingCollapsed;
      setThinkingCollapsed(next);
      props.onThinkingCollapsedChange?.(next);
      setStatus(next ? 'Thinking collapsed' : 'Thinking expanded');
      return;
    }

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
      if (selected) executeCommand(selected.name);
      setInput('');
      return;
    }

    if (!conversation || !session) return;

    const baseConversation = conversation;

    setError(null);
    setIsSending(true);
    // Show the user's message immediately, before the model starts responding.
    const optimisticUserMessage = createMessage('user', value.trim());
    setConversation({
      ...baseConversation,
      messages: [...baseConversation.messages, optimisticUserMessage],
    });
    setStreamingContent('');
    setStreamingThinking('');
    setThinkingDuration(null);
    streamingBufferRef.current = '';
    thinkingRef.current = { buffer: '', startMs: 0, durationMs: null };
    setInput('');
    setStatus('Waiting for response...');

    const flushInterval = setInterval(() => {
      const t = thinkingRef.current;
      if (t.buffer) setStreamingThinking(t.buffer);
      if (t.durationMs !== null) setThinkingDuration(t.durationMs);
      const cBuf = streamingBufferRef.current;
      if (cBuf) setStreamingContent(cBuf);
    }, 50);

    try {
      const attachments = await props.promptAttachmentService.resolveAttachments(value);
      const result = await props.chatSessionService.submitMessage({
        conversation: baseConversation,
        model: activeModel || session.activeModel,
        content: value,
        attachments,
        onToken: (token) => {
          if (thinkingRef.current.startMs && thinkingRef.current.durationMs === null) {
            thinkingRef.current.durationMs = Date.now() - thinkingRef.current.startMs;
          }
          streamingBufferRef.current += token;
        },
        onThinkingToken: (token) => {
          if (!thinkingRef.current.startMs) {
            thinkingRef.current.startMs = Date.now();
          }
          thinkingRef.current.buffer += token;
        },
      });

      const lastMsg = result.conversation.messages[result.conversation.messages.length - 1];
      const capturedThinking = thinkingRef.current.buffer;
      const capturedDuration =
        thinkingRef.current.durationMs ??
        (thinkingRef.current.startMs ? Date.now() - thinkingRef.current.startMs : 0);

      clearInterval(flushInterval);
      streamingBufferRef.current = '';
      thinkingRef.current = { buffer: '', startMs: 0, durationMs: null };

      startTransition(() => {
        setStreamingContent('');
        setStreamingThinking('');
        setThinkingDuration(null);
        setConversation(result.conversation);
        setStatus('Ready');
        if (lastMsg && capturedThinking) {
          setMessageThinking((prev) => ({
            ...prev,
            [lastMsg.id]: { content: capturedThinking, durationMs: capturedDuration },
          }));
        }
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
      thinkingRef.current = { buffer: '', startMs: 0, durationMs: null };
      setStreamingContent('');
      setStreamingThinking('');
      setThinkingDuration(null);
      setError(getErrorMessage(caughtError));
      setStatus('Request failed');
    } finally {
      setIsSending(false);
    }
  };

  if (showModelPicker) {
    return (
      <ModelPicker
        models={allModels}
        currentModel={activeModel}
        onSelect={handleModelSelect}
        onCancel={() => setShowModelPicker(false)}
      />
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan">justcode</Text>
      <Text dimColor>
        provider: {props.providerId} | session: {currentSessionId}
      </Text>
      <Text dimColor>
        Enter to send · Tab to complete @file or /command · Esc/Ctrl+C to exit
      </Text>

      <Box marginTop={1} flexDirection="column">
        {conversation?.messages.length ? (
          conversation.messages.map((message) => {
            const thinking = message.role === 'assistant' ? messageThinking[message.id] : undefined;
            return (
            <Box key={message.id} flexDirection="column">
              {thinking ? (
                <Box flexDirection="column" marginBottom={0}>
                  <Text color="yellow">
                    {thinkingCollapsed ? '+ ' : ''}Thought: {formatDuration(thinking.durationMs)}
                  </Text>
                  {thinkingCollapsed ? null : (
                    <Text dimColor>{thinking.content}</Text>
                  )}
                </Box>
              ) : null}
              {message.role === 'user' ? (
                <Box
                  flexDirection="column"
                  borderStyle="round"
                  borderColor="cyan"
                  borderTop={false}
                  borderRight={false}
                  borderBottom={false}
                  paddingLeft={1}
                  marginY={1}
                >
                  <Text bold color="white">
                    {message.content}
                  </Text>
                  <Text dimColor>{formatTime(message.createdAt)}</Text>
                </Box>
              ) : message.role === 'assistant' ? (
                <Text>{renderMarkdown(message.content)}</Text>
              ) : (
                <Text>
                  <Text color="yellow">{message.role}</Text>
                  <Text>: {message.content}</Text>
                </Text>
              )}
              {message.attachments?.map((attachment) => (
                <Text key={`${message.id}:${attachment.path}`} dimColor>
                  attached: @{attachment.path}
                </Text>
              ))}
            </Box>
            );
          })
        ) : (
          <Text dimColor>No messages yet.</Text>
        )}
        {streamingThinking || streamingContent ? (
          <Box flexDirection="column">
            {streamingThinking ? (
              <Box flexDirection="column">
                <Text color="yellow">
                  {thinkingDuration !== null
                    ? `${thinkingCollapsed ? '+ ' : ''}Thought: ${formatDuration(thinkingDuration)}`
                    : 'thinking...'}
                </Text>
                {thinkingCollapsed ? null : (
                  <Text dimColor>{streamingThinking}</Text>
                )}
              </Box>
            ) : null}
            {streamingContent ? (
              <Text>{renderMarkdown(streamingContent)}</Text>
            ) : null}
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
                <Text dimColor>
                  {cmd.name === 'thinking'
                    ? thinkingCollapsed
                      ? 'Expand thinking'
                      : 'Collapse thinking'
                    : cmd.description}
                </Text>
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
            {activeModel || session?.activeModel || 'loading'}
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
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}

function contextPct(inputTokens: number, contextWindow: number): number {
  return Math.round((inputTokens / contextWindow) * 100);
}

function formatTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;

  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    const rounded = Math.round(totalSeconds * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return seconds > 0 ? `${minutes}min ${seconds}s` : `${minutes}min`;
}
