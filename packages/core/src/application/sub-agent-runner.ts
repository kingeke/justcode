import {
  createMessage,
  MessageRole,
  type ChatMessage,
} from '@core/domain/message';
import type { ProviderClient, TokenUsage } from '@core/ports/chat-model';
import type { Tool, ToolInvocationView } from '@core/ports/tool';
import { buildSystemPrompt } from '@core/application/system-prompt';
import type { SubAgentRunStats } from '@core/domain/sub-agent';

export interface SubAgentToolActivity {
  toolName: string;
  view: ToolInvocationView;
}

export interface RunSubAgentInput {
  provider: ProviderClient;
  model: string;
  /** The tools the sub agent may call. Executed without user approval. */
  tools: Tool[];
  /** The delegated task, sent as the sub agent's first user message. */
  prompt: string;
  systemPrompt: string;
  workspaceRoot: string;
  /**
   * A session id unique to this run. Session-oriented providers (Claude Code)
   * key their live session on it — which is what gives the sub agent real tool
   * calling; their ephemeral path has no tools and the model would emit tool
   * calls as prose. The caller must close the session when the run ends (see
   * `ProviderClient.closeSession`).
   */
  sessionId: string;
  signal?: AbortSignal;
  /** Fired for every message appended to the sub agent's transcript. */
  onMessage?: (message: ChatMessage) => void;
  /** Fired before each tool call executes, for live progress display. */
  onToolActivity?: (activity: SubAgentToolActivity) => void;
  /**
   * Fired as the run progresses (on its first streamed token and after each
   * model step) with the run's live metrics so far, so a viewer's footer can
   * track it in real time rather than only when it finishes.
   */
  onStats?: (stats: SubAgentRunStats, usage?: TokenUsage) => void;
}

export interface RunSubAgentResult {
  /** The sub agent's final report (its last plain assistant message). */
  summary: string;
  /** The sub agent's full transcript, for persistence and review. */
  messages: ChatMessage[];
  toolUseCount: number;
  usage?: TokenUsage;
  /** The run's own token/throughput metrics. */
  stats?: SubAgentRunStats;
}

/**
 * A minimal agentic loop for sub agents: send the transcript, execute any tool
 * calls, and repeat until the model replies without tools (or the run is
 * aborted). Deliberately independent of `ChatSessionService` — no persistence,
 * approvals, compaction, or titles; the caller owns all of that. There is no
 * round-trip cap: the sub agent works until done, and the abort signal is the
 * user's stop.
 */
export async function runSubAgent(
  input: RunSubAgentInput
): Promise<RunSubAgentResult> {
  const toolsByName = new Map(
    input.tools.map((tool) => [tool.definition.name, tool])
  );
  const toolDefinitions = input.tools.map((tool) => tool.definition);
  const systemMessage = createMessage(
    MessageRole.System,
    buildSystemPrompt(input.systemPrompt, input.workspaceRoot, toolDefinitions)
  );

  const messages: ChatMessage[] = [];
  const append = (message: ChatMessage): void => {
    messages.push(message);
    input.onMessage?.(message);
  };
  append(createMessage(MessageRole.User, input.prompt));

  let usage: TokenUsage | undefined;
  let toolUseCount = 0;

  // Per-run metrics, mirroring the main session footer but scoped to this run.
  const runStartMs = Date.now();
  let firstTokenMs: number | null = null;
  let lastInputTokens = 0;
  let tokensPerSecond: number | undefined;
  const tokensPerSecondAvg = { avg: 0, count: 0 };

  const currentStats = (): SubAgentRunStats => ({
    lastInputTokens,
    ...(firstTokenMs !== null ? { ttftMs: firstTokenMs - runStartMs } : {}),
    ...(tokensPerSecond !== undefined ? { tokensPerSecond } : {}),
    ...(tokensPerSecondAvg.count > 0
      ? { avgTokensPerSecond: tokensPerSecondAvg.avg }
      : {}),
  });

  for (;;) {
    throwIfAborted(input.signal);

    const stepStartMs = Date.now();
    let stepFirstTokenMs: number | null = null;
    const response = await input.provider.sendChat({
      model: input.model,
      sessionId: input.sessionId,
      messages: [systemMessage, ...messages],
      ...(toolDefinitions.length > 0 ? { tools: toolDefinitions } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      // Streaming keeps HTTP providers on their streaming path, which has no
      // fixed response deadline (the non-streaming path rides `requestJson`'s
      // hard timeout, which a long reasoning step can easily exceed). The
      // tokens aren't shown, but the first one's timestamp gives us TTFT and
      // the generation window for the throughput readout.
      onToken: () => {
        if (stepFirstTokenMs === null) stepFirstTokenMs = Date.now();
        if (firstTokenMs === null) {
          firstTokenMs = Date.now();
          // Surface TTFT the moment the run starts producing, so the footer
          // stops waiting on the whole (possibly long) first response.
          input.onStats?.(currentStats(), usage);
        }
      },
    });

    throwIfAborted(input.signal);

    if (response.usage) {
      usage = usage ? sumUsage(usage, response.usage) : response.usage;
      lastInputTokens = response.usage.inputTokens;
      // Throughput for this step: output tokens over the generation window
      // (first token → now). Folded into a running average across steps, the
      // same formula the main footer uses.
      const genSeconds =
        Math.max(Date.now() - (stepFirstTokenMs ?? stepStartMs), 1) / 1000;
      if (response.usage.outputTokens > 0) {
        tokensPerSecond = response.usage.outputTokens / genSeconds;
        tokensPerSecondAvg.count += 1;
        tokensPerSecondAvg.avg +=
          (tokensPerSecond - tokensPerSecondAvg.avg) / tokensPerSecondAvg.count;
      }
    }
    input.onStats?.(currentStats(), usage);

    const toolCalls = response.toolCalls ?? [];
    if (toolCalls.length === 0) {
      append(createMessage(MessageRole.Assistant, response.content));
      return {
        summary: response.content,
        messages,
        toolUseCount,
        ...(usage ? { usage } : {}),
        stats: currentStats(),
      };
    }

    append(
      createMessage(
        MessageRole.Assistant,
        response.content,
        new Date(),
        undefined,
        {
          toolCalls,
        }
      )
    );

    for (const call of toolCalls) {
      throwIfAborted(input.signal);
      toolUseCount += 1;
      const tool = toolsByName.get(call.name);
      if (!tool) {
        append(
          createMessage(
            MessageRole.Tool,
            `Unknown tool: ${call.name}. Available tools: ${[...toolsByName.keys()].join(', ')}.`,
            new Date(),
            undefined,
            { toolCallId: call.id, name: call.name, isError: true }
          )
        );
        continue;
      }

      input.onToolActivity?.({
        toolName: call.name,
        view: describeSafely(tool, call.arguments),
      });

      let content: string;
      let isError = false;
      try {
        const result = await tool.execute(call.arguments, {
          workspaceRoot: input.workspaceRoot,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        content = result.content;
        isError = result.isError === true;
      } catch (error) {
        if (isAbortError(error) || input.signal?.aborted) throw error;
        content = `Tool failed: ${error instanceof Error ? error.message : String(error)}`;
        isError = true;
      }
      append(
        createMessage(MessageRole.Tool, content, new Date(), undefined, {
          toolCallId: call.id,
          name: call.name,
          ...(isError ? { isError: true } : {}),
        })
      );
    }
  }
}

function describeSafely(tool: Tool, rawArguments: string): ToolInvocationView {
  try {
    return tool.describe(rawArguments);
  } catch {
    return { title: tool.definition.name };
  }
}

function sumUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    ...(a.cost !== undefined || b.cost !== undefined
      ? { cost: (a.cost ?? 0) + (b.cost ?? 0) }
      : {}),
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('Aborted');
    error.name = 'AbortError';
    throw error;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
