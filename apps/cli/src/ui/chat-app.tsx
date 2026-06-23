import React, {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';

import {
  applyMentionSuggestion,
  filterMentionSuggestions,
  getActiveMentionQuery,
  hasActiveMentionTrigger,
  type PromptAttachmentService,
} from '@core/application/prompt-attachment-service';
import type {
  ChatSessionService,
  StartSessionResult,
  ToolActivityEvent,
  ToolApprovalRequest,
} from '@core/application/chat-session-service';
import type { Conversation } from '@core/domain/conversation';
import { createMessage } from '@core/domain/message';
import type {
  ModelInfo,
  ProviderId,
  ProviderClient,
} from '@core/ports/chat-model';
import type { ProviderConnectionInfo } from '@core/ports/provider-catalog';
import { renderMarkdown, renderMarkdownAsync } from './render-markdown.js';
import { COMMANDS, filterCommands, parseCommandInput } from './commands.js';
import { ConnectPicker } from './connect-picker.js';
import { ModelPicker } from './model-picker.js';

const MAX_COMMAND_ITEMS = 8;

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
  initialAutoApplyWrites?: boolean;
  onAutoApplyWritesChange?: (autoApply: boolean) => void;
  initialMaxReadBytes?: number;
  onMaxReadBytesChange?: (bytes: number) => void;
}

interface PendingApproval {
  request: ToolApprovalRequest;
  resolve: (approved: boolean) => void;
}

interface ToolEvent {
  key: number;
  toolName: string;
  title: string;
  status: 'running' | 'done' | 'error';
}

const MAX_PREVIEW_LINES = 16;
const EXIT_HINT = 'Press Ctrl+C again to exit';

function getInitialMetrics(): {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cost: number;
  lastInputTokens: number;
} {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    cost: 0,
    lastInputTokens: 0,
  };
}

export function ChatApp(props: ChatAppProps): React.ReactElement {
  const { exit } = useApp();
  const [showConnectPicker, setShowConnectPicker] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [allModels, setAllModels] = useState<ModelInfo[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState(props.sessionId);
  const [session, setSession] = useState<StartSessionResult | null>(null);
  const [activeModel, setActiveModel] = useState<string>('');
  const [activeModelInfo, setActiveModelInfo] = useState<ModelInfo | null>(
    null
  );
  const [activeProviderId, setActiveProviderId] = useState(props.providerId);
  const [metrics, setMetrics] = useState(getInitialMetrics);
  const [lastStats, setLastStats] = useState<{
    ttftMs: number;
    tokensPerSecond: number;
    avgTokensPerSecond: number;
  } | null>(null);
  const sessionStatsRef = useRef({
    outputTokens: 0,
    generationMs: 0,
  });
  const responseTimingRef = useRef<{
    startMs: number;
    firstTokenMs: number | null;
  }>({ startMs: 0, firstTokenMs: null });
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [input, setInput] = useState('');
  // Bumping this remounts the text input so its cursor jumps to the end after
  // we replace the value programmatically (tab-completion); ink-text-input
  // otherwise keeps its own cursor offset.
  const [inputKey, setInputKey] = useState(0);

  const setInputWithCursorAtEnd = (next: string): void => {
    setInput(next);
    setInputKey((key) => key + 1);
  };
  const activeRequestControllerRef = useRef<AbortController | null>(null);
  const nextSessionRequestedModelRef = useRef<string | undefined>(undefined);

  const cancelActiveRequest = (): void => {
    activeRequestControllerRef.current?.abort();
  };

  const resetFreshSessionState = (): void => {
    cancelActiveRequest();
    setPendingApproval((current) => {
      current?.resolve(false);
      return null;
    });
    setIsSending(false);
    setConversation(null);
    setError(null);
    setLastStats(null);
    setMetrics(getInitialMetrics());
    setStreamingContent('');
    setStreamingThinking('');
    setThinkingDuration(null);
    setToolEvents([]);
    setMessageThinking({});
    setRenderedContent({});
    streamingBufferRef.current = '';
    thinkingRef.current = { buffer: '', startMs: 0, durationMs: null };
    responseTimingRef.current = { startMs: 0, firstTokenMs: null };
    sessionStatsRef.current = { outputTokens: 0, generationMs: 0 };
  };
  const [status, setStatus] = useState<string>('Loading session...');
  const [isSending, setIsSending] = useState(false);
  const [activityTick, setActivityTick] = useState(0);
  const [streamingContent, setStreamingContent] = useState<string>('');
  const streamingBufferRef = useRef('');
  const [streamingThinking, setStreamingThinking] = useState<string>('');
  const [thinkingDuration, setThinkingDuration] = useState<number | null>(null);
  const thinkingRef = useRef<{
    buffer: string;
    startMs: number;
    durationMs: number | null;
  }>({
    buffer: '',
    startMs: 0,
    durationMs: null,
  });
  const [messageThinking, setMessageThinking] = useState<
    Record<string, { content: string; durationMs: number }>
  >({});
  const [error, setError] = useState<string | null>(null);
  // Shiki highlighting is async, so finalized assistant messages are rendered
  // off the render path and cached here by message id.
  const [renderedContent, setRenderedContent] = useState<
    Record<string, string>
  >({});
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [thinkingCollapsed, setThinkingCollapsed] = useState(
    props.initialThinkingCollapsed ?? false
  );
  const [autoApplyWrites, setAutoApplyWrites] = useState(
    props.initialAutoApplyWrites ?? false
  );
  const autoApplyWritesRef = useRef(props.initialAutoApplyWrites ?? false);
  const maxReadBytesRef = useRef(props.initialMaxReadBytes ?? 50 * 1024);
  const [maxReadBytes, setMaxReadBytes] = useState(
    props.initialMaxReadBytes ?? 50 * 1024
  );
  const [pendingApproval, setPendingApproval] =
    useState<PendingApproval | null>(null);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const toolEventKeyRef = useRef(0);
  // Armed by a Ctrl+C that didn't exit (it cleared text or hit an empty input);
  // the next Ctrl+C exits. Disarmed as soon as the user types again.
  const exitArmedRef = useRef(false);

  const isCommandMode = input.startsWith('/') && !input.includes(' ');
  const commandQuery = isCommandMode ? (parseCommandInput(input) ?? '') : '';
  const filteredCommands = useMemo(
    () => (isCommandMode ? filterCommands(commandQuery) : []),
    [isCommandMode, commandQuery]
  );
  const visibleCommands = filteredCommands.slice(0, MAX_COMMAND_ITEMS);

  const activeMentionQuery = useMemo(
    () => (isCommandMode ? null : getActiveMentionQuery(input)),
    [isCommandMode, input]
  );
  const activeMentionTrigger = useMemo(
    () => (isCommandMode ? false : hasActiveMentionTrigger(input)),
    [isCommandMode, input]
  );
  const showInterruptHint = isSending || pendingApproval !== null;
  const displayStats = isSending
    ? getLiveStats(
        responseTimingRef.current,
        streamingThinking + streamingContent,
        activityTick,
        sessionStatsRef.current
      )
    : lastStats;
  const mentionSuggestions = useMemo(
    () =>
      filterMentionSuggestions(workspaceFiles, activeMentionQuery ?? undefined),
    [activeMentionQuery, workspaceFiles]
  );
  const showMentionSuggestions =
    activeMentionTrigger && !isCommandMode && workspaceFiles.length > 0;
  const noMentionMatches =
    activeMentionTrigger &&
    activeMentionQuery !== undefined &&
    mentionSuggestions.length === 0;
  const selectedSuggestion =
    mentionSuggestions[selectedSuggestionIndex] ?? mentionSuggestions[0];

  useInput((value, key) => {
    if (showModelPicker || showConnectPicker) return;

    if (pendingApproval) {
      const choice = value.toLowerCase();
      if (key.ctrl && choice === 'c') {
        exit();
        return;
      }
      if (choice === 'y' || key.return) {
        resolveApproval(true, false);
      } else if (choice === 'a') {
        resolveApproval(true, true);
      } else if (choice === 'n') {
        resolveApproval(false, false);
      } else if (key.escape) {
        cancelActiveRequest();
      }
      return;
    }

    if (key.ctrl && value.toLowerCase() === 'c') {
      // Clear any typed text first; otherwise arm exit and confirm on the next
      // Ctrl+C.
      if (input) {
        setInputWithCursorAtEnd('');
        exitArmedRef.current = true;
        setStatus(EXIT_HINT);
        return;
      }
      if (exitArmedRef.current) {
        exit();
        return;
      }
      exitArmedRef.current = true;
      setStatus(EXIT_HINT);
      return;
    }

    if (key.escape) {
      if (isSending) {
        cancelActiveRequest();
        return;
      }

      if (input) {
        setInputWithCursorAtEnd('');
        exitArmedRef.current = false;
        setStatus('Ready');
        return;
      }

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
        if (cmd) setInputWithCursorAtEnd(`/${cmd.name} `);
        return;
      }
      return;
    }

    if (!showMentionSuggestions) return;

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
        setInputKey((key) => key + 1);
      }
    }
  });

  useEffect(() => {
    setSelectedCommandIndex(0);
  }, [commandQuery]);

  useEffect(() => {
    setSelectedSuggestionIndex(0);
  }, [activeMentionQuery]);

  useEffect(() => {
    return () => {
      activeRequestControllerRef.current?.abort();
    };
  }, []);

  // Typing cancels a pending "Ctrl+C again to exit".
  useEffect(() => {
    if (input && exitArmedRef.current) {
      exitArmedRef.current = false;
      setStatus((current) => (current === EXIT_HINT ? 'Ready' : current));
    }
  }, [input]);

  const loadSession = (
    sessionId: string,
    requestedModel?: string
  ): void => {
    resetFreshSessionState();
    setStatus('Loading session...');
    setSession(null);
    setConversation(null);
    setActiveModel('');
    setActiveModelInfo(null);
    const modelForSession = requestedModel ?? props.requestedModel;
    void props.chatSessionService
      .startSession(
        modelForSession ? { sessionId, requestedModel: modelForSession } : { sessionId }
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
    loadSession(currentSessionId, nextSessionRequestedModelRef.current);
    nextSessionRequestedModelRef.current = undefined;
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

  useEffect(() => {
    const messages = conversation?.messages;
    if (!messages) return;
    let cancelled = false;
    void (async () => {
      for (const message of messages) {
        if (message.role !== 'assistant' || !message.content) continue;
        if (renderedContent[message.id]) continue;
        const rendered = await renderMarkdownAsync(message.content);
        if (cancelled) return;
        setRenderedContent((prev) =>
          prev[message.id] ? prev : { ...prev, [message.id]: rendered }
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversation, renderedContent]);

  const handleModelSelect = (model: ModelInfo): void => {
    setShowModelPicker(false);
    if (model.providerId !== activeProviderId) {
      try {
        const newProvider = props.createProvider(model.providerId);
        props.chatSessionService.switchProvider(newProvider);
        setActiveProviderId(model.providerId);
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

  const handleConnectSelect = async (
    providerInfo: ProviderConnectionInfo
  ): Promise<void> => {
    let provider: ProviderClient;

    try {
      provider = props.createProvider(providerInfo.id);
    } catch (e) {
      setError(getErrorMessage(e));
      setStatus('Connect failed');
      return;
    }

    try {
      const models = await provider.listModels();
      if (models.length === 0) {
        setError(`No models are available for provider '${providerInfo.name}'.`);
        setStatus('Connect failed');
        return;
      }

      const selectedModel =
        models.find((model) => model.id === provider.getDefaultModel()) ??
        models[0];
      if (!selectedModel) {
        setError(`No models are available for provider '${providerInfo.name}'.`);
        setStatus('Connect failed');
        return;
      }

      props.chatSessionService.switchProvider(provider);
      startTransition(() => {
        setActiveProviderId(providerInfo.id);
        setActiveModel(selectedModel.id);
        setActiveModelInfo(selectedModel);
        setStatus(`Connected to ${providerInfo.name}`);
      });
      props.onModelChange?.(selectedModel.id, providerInfo.id);
      setShowConnectPicker(false);
    } catch (e) {
      setError(getErrorMessage(e));
      setStatus('Connect failed');
    }
  };

  const resolveApproval = (approved: boolean, always: boolean): void => {
    if (always) {
      setAutoApplyWrites(true);
      autoApplyWritesRef.current = true;
      props.onAutoApplyWritesChange?.(true);
    }
    setPendingApproval((current) => {
      current?.resolve(approved);
      return null;
    });
  };

  const executeCommand = (name: string, arg?: string): void => {
    setInput('');
    setError(null);

    if (name === 'models') {
      setShowModelPicker(true);
      return;
    }

    if (name === 'connect') {
      setStatus('Select a provider to connect');
      setShowConnectPicker(true);
      return;
    }

    if (name === 'read-limit') {
      const trimmed = (arg ?? '').trim();
      const currentKb = Math.round(maxReadBytesRef.current / 1024);
      if (!trimmed) {
        setStatus(
          `Read limit is ${currentKb} KB (use /read-limit <KB> to change)`
        );
        return;
      }
      const kb = Number.parseInt(trimmed, 10);
      if (!Number.isFinite(kb) || kb <= 0) {
        setError(
          `Invalid read limit '${trimmed}'. Provide a positive number of KB.`
        );
        return;
      }
      const bytes = kb * 1024;
      maxReadBytesRef.current = bytes;
      setMaxReadBytes(bytes);
      props.onMaxReadBytesChange?.(bytes);
      setStatus(`Read limit set to ${kb} KB`);
      return;
    }

    if (name === 'auto-writes') {
      const next = !autoApplyWritesRef.current;
      setAutoApplyWrites(next);
      autoApplyWritesRef.current = next;
      props.onAutoApplyWritesChange?.(next);
      setStatus(next ? 'Auto-applying writes' : 'Confirming each write');
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
      resetFreshSessionState();
      const newId = `session-${Date.now()}`;
      const nextRequestedModel = activeModel || props.requestedModel;
      nextSessionRequestedModelRef.current = nextRequestedModel;
      setCurrentSessionId(newId);
      return;
    }

    if (name === 'clear') {
      resetFreshSessionState();
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

    if (showMentionSuggestions && selectedSuggestion) {
      setInputWithCursorAtEnd(applyMentionSuggestion(value, selectedSuggestion));
      return;
    }

    const commandInput = parseCommandInput(value);
    if (commandInput !== null) {
      const spaceIndex = commandInput.indexOf(' ');
      const hasArg = spaceIndex !== -1;
      const commandName = hasArg
        ? commandInput.slice(0, spaceIndex)
        : commandInput;
      const arg = hasArg ? commandInput.slice(spaceIndex + 1) : undefined;

      if (hasArg) {
        // Explicit name + argument (e.g. "/read-limit 64").
        if (COMMANDS.some((c) => c.name === commandName)) {
          executeCommand(commandName, arg);
        } else {
          setError(`Unknown command '/${commandName}'.`);
        }
      } else {
        // No argument: prefer an exact name (e.g. after tab-completing and
        // submitting), otherwise honour the highlighted suggestion.
        const exact = COMMANDS.find((c) => c.name === commandName);
        const selected = exact ?? visibleCommands[selectedCommandIndex];
        if (selected) executeCommand(selected.name);
      }
      setInput('');
      return;
    }

    if (!conversation || !session) return;

    const requestController = new AbortController();
    activeRequestControllerRef.current = requestController;

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
    setToolEvents([]);
    streamingBufferRef.current = '';
    thinkingRef.current = { buffer: '', startMs: 0, durationMs: null };
    responseTimingRef.current = { startMs: Date.now(), firstTokenMs: null };
    setLastStats(null);
    setInput('');
    setStatus('Waiting for response...');

    const flushInterval = setInterval(() => {
      setActivityTick((tick) => tick + 1);
      const t = thinkingRef.current;
      if (t.buffer) setStreamingThinking(t.buffer);
      if (t.durationMs !== null) setThinkingDuration(t.durationMs);
      const cBuf = streamingBufferRef.current;
      if (cBuf) setStreamingContent(cBuf);
    }, 50);

    const requestApproval = (
      request: ToolApprovalRequest
    ): Promise<boolean> => {
      if (autoApplyWritesRef.current) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        setStatus('Awaiting approval...');
        setPendingApproval({ request, resolve });
      });
    };

    const onToolActivity = (event: ToolActivityEvent): void => {
      if (event.phase === 'start') {
        // A turn finished and tools are running; drop the streamed preamble so
        // the next turn's text renders cleanly.
        streamingBufferRef.current = '';
        setStreamingContent('');
        const key = (toolEventKeyRef.current += 1);
        setToolEvents((prev) => [
          ...prev,
          {
            key,
            toolName: event.toolName,
            title: event.view.title,
            status: 'running',
          },
        ]);
        return;
      }
      setToolEvents((prev) => {
        const next = [...prev];
        for (let index = next.length - 1; index >= 0; index -= 1) {
          const entry = next[index];
          if (entry?.status === 'running') {
            next[index] = {
              ...entry,
              status: event.result?.isError ? 'error' : 'done',
            };
            break;
          }
        }
        return next;
      });
    };

    try {
      const attachments =
        await props.promptAttachmentService.resolveAttachments(
          value,
          requestController.signal
        );
      const result = await props.chatSessionService.submitMessage({
        conversation: baseConversation,
        model: activeModel || session.activeModel,
        content: value,
        attachments,
        signal: requestController.signal,
        requestApproval,
        onToolActivity,
        onToken: (token) => {
          if (responseTimingRef.current.firstTokenMs === null) {
            responseTimingRef.current.firstTokenMs = Date.now();
          }
          if (
            thinkingRef.current.startMs &&
            thinkingRef.current.durationMs === null
          ) {
            thinkingRef.current.durationMs =
              Date.now() - thinkingRef.current.startMs;
          }
          streamingBufferRef.current += token;
        },
        onThinkingToken: (token) => {
          if (responseTimingRef.current.firstTokenMs === null) {
            responseTimingRef.current.firstTokenMs = Date.now();
          }
          if (!thinkingRef.current.startMs) {
            thinkingRef.current.startMs = Date.now();
          }
          thinkingRef.current.buffer += token;
        },
      });

      const endMs = Date.now();
      const timing = responseTimingRef.current;
      const lastMsg =
        result.conversation.messages[result.conversation.messages.length - 1];
      const capturedThinking = thinkingRef.current.buffer;
      const capturedContent = streamingBufferRef.current;
      const capturedDuration =
        thinkingRef.current.durationMs ??
        (thinkingRef.current.startMs
          ? Date.now() - thinkingRef.current.startMs
          : 0);
      const capturedGenerationMs = Math.max(
        endMs - (timing.firstTokenMs ?? endMs),
        0
      );
      const sessionTotals = sessionStatsRef.current;
      const nextOutputTokens = estimateTokenCount(
        capturedThinking + capturedContent
      );
      const nextTotalOutputTokens = sessionTotals.outputTokens + nextOutputTokens;
      const nextGenerationMs = sessionTotals.generationMs + capturedGenerationMs;
      const nextAverageTokensPerSecond = getAverageTokensPerSecond(
        nextTotalOutputTokens,
        nextGenerationMs
      );

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
            [lastMsg.id]: {
              content: capturedThinking,
              durationMs: capturedDuration,
            },
          }));
        }
        if (timing.firstTokenMs !== null) {
          const ttftMs = timing.firstTokenMs - timing.startMs;
          const genSeconds = Math.max(capturedGenerationMs, 1) / 1000;
          setLastStats({
            ttftMs,
            tokensPerSecond: nextOutputTokens / genSeconds,
            avgTokensPerSecond: nextAverageTokensPerSecond,
          });
          sessionStatsRef.current = {
            outputTokens: nextTotalOutputTokens,
            generationMs: nextGenerationMs,
          };
        }
        if (result.usage) {
          const u = result.usage;
          const pricing = activeModelInfo?.pricing;
          const requestCost = pricing
            ? u.inputTokens * pricing.inputPerToken +
              u.outputTokens * pricing.outputPerToken +
              u.cachedTokens *
                (pricing.cacheReadPerToken ?? pricing.inputPerToken)
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
      setPendingApproval(null);

      if (isAbortError(caughtError)) {
        const capturedThinking = thinkingRef.current.buffer;
        const capturedContent = streamingBufferRef.current;
        const capturedDuration =
          thinkingRef.current.durationMs ??
          (thinkingRef.current.startMs
            ? Date.now() - thinkingRef.current.startMs
            : 0);

        if (capturedThinking || capturedContent) {
          const interruptedMessage = createMessage(
            'assistant',
            capturedContent,
            new Date(),
            undefined,
            capturedThinking
              ? {
                  thinking: {
                    content: capturedThinking,
                    durationMs: capturedDuration,
                  },
                }
              : undefined
          );

          setConversation((current) =>
            current
              ? {
                  ...current,
                  messages: [...current.messages, interruptedMessage],
                }
              : current
          );
        }

        streamingBufferRef.current = '';
        thinkingRef.current = { buffer: '', startMs: 0, durationMs: null };
        setStreamingContent('');
        setStreamingThinking('');
        setThinkingDuration(null);
        setError(null);
        setStatus('Interrupted');
      } else {
        streamingBufferRef.current = '';
        thinkingRef.current = { buffer: '', startMs: 0, durationMs: null };
        setStreamingContent('');
        setStreamingThinking('');
        setThinkingDuration(null);
        setError(getErrorMessage(caughtError));
        setStatus('Request failed');
      }
    } finally {
      setIsSending(false);
      activeRequestControllerRef.current = null;
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

  if (showConnectPicker) {
    return (
      <ConnectPicker
        activeProviderId={activeProviderId}
        onSelect={(providerInfo) => void handleConnectSelect(providerInfo)}
        onCancel={() => setShowConnectPicker(false)}
      />
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan">justcode</Text>
      <Text dimColor>
        provider: {activeProviderId} | session: {currentSessionId}
      </Text>
      <Text dimColor>
        Enter to send · Tab to complete @file or /command · Esc to cancel or
        interrupt · Ctrl+C to exit
      </Text>

      <Box marginTop={1} flexDirection="column">
        {conversation?.messages.length ? (
          conversation.messages.map((message) => {
            const thinking =
              message.role === 'assistant'
                ? message.thinking ?? messageThinking[message.id]
                : undefined;
            return (
              <Box key={message.id} flexDirection="column">
                {thinking ? (
                  <Box flexDirection="column" marginBottom={0}>
                    <Text color="yellow">
                      {thinkingCollapsed ? '+ ' : ''}Thought:{' '}
                      {formatDuration(thinking.durationMs)}
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
                  <Box flexDirection="column">
                    {message.content ? (
                      <Text>
                        {renderedContent[message.id] ??
                          renderMarkdown(message.content)}
                      </Text>
                    ) : null}
                    {message.toolCalls?.map((call) => (
                      <Text key={call.id} color="magenta">
                        ⚙ {call.name}({summarizeToolArgs(call.arguments)})
                      </Text>
                    ))}
                  </Box>
                ) : message.role === 'tool' ? (
                  <Text dimColor>
                    {'  ↳ '}
                    {firstLine(message.content)}
                  </Text>
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
        {toolEvents.length ? (
          <Box flexDirection="column" marginTop={1}>
            {toolEvents.map((event) => (
              <Text
                key={event.key}
                color={
                  event.status === 'error'
                    ? 'red'
                    : event.status === 'done'
                      ? 'green'
                      : 'yellow'
                }
              >
                {event.status === 'running'
                  ? '⚙ '
                  : event.status === 'done'
                    ? '✓ '
                    : '✗ '}
                {event.title}
              </Text>
            ))}
          </Box>
        ) : null}
        {pendingApproval ? (
          <Box
            flexDirection="column"
            marginTop={1}
            borderStyle="round"
            borderColor="yellow"
            paddingX={1}
          >
            <Text bold color="yellow">
              Run {pendingApproval.request.toolName}?
            </Text>
            <Text>{pendingApproval.request.title}</Text>
            {pendingApproval.request.preview ? (
              <Box marginTop={1}>
                <Text dimColor>
                  {truncatePreview(pendingApproval.request.preview)}
                </Text>
              </Box>
            ) : null}
            <Box marginTop={1}>
              <Text>
                <Text color="green">[y]</Text>es{'  '}
                <Text color="cyan">[a]</Text>lways{'  '}
                <Text color="red">[n]</Text>o
              </Text>
            </Box>
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
              <Text
                {...(index === selectedCommandIndex ? { color: 'cyan' } : {})}
              >
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
                {cmd.name === 'auto-writes' ? (
                  <Text>
                    {'  '}
                    <Text color={autoApplyWrites ? 'green' : 'yellow'}>
                      [{autoApplyWrites ? 'on' : 'off'}]
                    </Text>
                  </Text>
                ) : null}
                {cmd.name === 'read-limit' ? (
                  <Text>
                    {'  '}
                    <Text color="green">
                      [{Math.round(maxReadBytes / 1024)} KB]
                    </Text>
                  </Text>
                ) : null}
              </Text>
            </Box>
          ))}
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text>{isSending ? 'sending' : 'prompt'}&gt; </Text>
        <TextInput
          key={inputKey}
          value={input}
          onChange={setInput}
          onSubmit={submit}
          focus={!isSending}
        />
      </Box>

      {!isCommandMode && showMentionSuggestions ? (
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
          {noMentionMatches ? <Text dimColor>no file found</Text> : null}
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
            {activeModelInfo?.providerId ?? props.providerId}/
            {activeModel || session?.activeModel || 'loading'}
          </Text>
          {showInterruptHint ? (
            <Text dimColor> · Press Esc to interrupt</Text>
          ) : null}
        </Box>
      </Box>
      {metrics.inputTokens > 0 ? (
        <Box marginTop={1}>
          <Text dimColor>
            in{' '}
            <Text color="white">{metrics.inputTokens.toLocaleString()}</Text>{' '}
            out{' '}
            <Text color="white">{metrics.outputTokens.toLocaleString()}</Text>
            {metrics.cachedTokens > 0 ? (
              <>
                {' '}
                cached{' '}
                <Text color="white">
                  {metrics.cachedTokens.toLocaleString()}
                </Text>
              </>
            ) : null}
            {activeModelInfo?.contextWindow ? (
              <>
                {' '}
                ctx{' '}
                <Text
                  color={
                    contextPct(
                      metrics.lastInputTokens,
                      activeModelInfo.contextWindow
                    ) > 80
                      ? 'yellow'
                      : 'white'
                  }
                >
                  {contextPct(
                    metrics.lastInputTokens,
                    activeModelInfo.contextWindow
                  )}
                  %
                </Text>
              </>
            ) : null}
            {metrics.cost > 0 ? (
              <>
                {' '}
                $<Text color="white">{metrics.cost.toFixed(4)}</Text>
              </>
            ) : null}
          </Text>
        </Box>
      ) : null}
      <Box marginTop={1} justifyContent="flex-end">
        {displayStats ? (
          <Text dimColor>
            TTFT {formatDuration(displayStats.ttftMs)} ·{' '}
            <Text color="white">
              {displayStats.tokensPerSecond.toFixed(1)}
            </Text>{' '}
            tok/s · AVG{' '}
            <Text color="white">
              {displayStats.avgTokensPerSecond.toFixed(1)}
            </Text>
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
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function getLiveStats(
  timing: { startMs: number; firstTokenMs: number | null },
  outputText: string,
  tick: number,
  sessionTotals: { outputTokens: number; generationMs: number }
): { ttftMs: number; tokensPerSecond: number; avgTokensPerSecond: number } | null {
  if (!timing.startMs) {
    return null;
  }

  const now = Date.now();
  const firstTokenMs = timing.firstTokenMs ?? now;
  const ttftMs = Math.max(firstTokenMs - timing.startMs, 0);
  const genElapsedMs = Math.max(now - firstTokenMs, 1);
  const estimatedTokens = estimateTokenCount(outputText);
  const currentTokensPerSecond = estimatedTokens / (genElapsedMs / 1000);
  const avgTokensPerSecond = getAverageTokensPerSecond(
    sessionTotals.outputTokens + estimatedTokens,
    sessionTotals.generationMs + genElapsedMs
  );

  // `tick` is included so the caller can force a rerender on a timer.
  void tick;

  return {
    ttftMs,
    tokensPerSecond: currentTokensPerSecond,
    avgTokensPerSecond,
  };
}

function getAverageTokensPerSecond(
  outputTokens: number,
  generationMs: number
): number {
  if (outputTokens <= 0 || generationMs <= 0) {
    return 0;
  }

  return outputTokens / (generationMs / 1000);
}

function estimateTokenCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }

  return Math.max(1, Math.round(trimmed.length / 4));
}

function summarizeToolArgs(rawArguments: string): string {
  try {
    const parsed = JSON.parse(rawArguments) as Record<string, unknown>;
    if (typeof parsed.path === 'string') return parsed.path;
    const keys = Object.keys(parsed);
    return keys.length ? keys.join(', ') : '';
  } catch {
    return truncate(rawArguments, 40);
  }
}

function firstLine(content: string): string {
  const [line = ''] = content.split('\n');
  return truncate(line, 100);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function truncatePreview(preview: string): string {
  const lines = preview.split('\n');
  if (lines.length <= MAX_PREVIEW_LINES) return preview;
  return [
    ...lines.slice(0, MAX_PREVIEW_LINES),
    `… (${lines.length - MAX_PREVIEW_LINES} more lines)`,
  ].join('\n');
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
