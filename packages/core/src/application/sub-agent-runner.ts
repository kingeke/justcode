import {
  createMessage,
  MessageRole,
  type ChatMessage,
} from '@core/domain/message';
import type { ProviderClient, TokenUsage } from '@core/ports/chat-model';
import type { Tool, ToolInvocationView } from '@core/ports/tool';
import { buildSystemPrompt } from '@core/application/system-prompt';

/** Hard cap on model round-trips so a confused sub agent can't loop forever. */
export const DEFAULT_SUB_AGENT_MAX_ITERATIONS = 25;

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
  maxIterations?: number;
  /** Fired for every message appended to the sub agent's transcript. */
  onMessage?: (message: ChatMessage) => void;
  /** Fired before each tool call executes, for live progress display. */
  onToolActivity?: (activity: SubAgentToolActivity) => void;
}

export interface RunSubAgentResult {
  /** The sub agent's final report (its last plain assistant message). */
  summary: string;
  /** The sub agent's full transcript, for persistence and review. */
  messages: ChatMessage[];
  toolUseCount: number;
  usage?: TokenUsage;
}

/**
 * A minimal agentic loop for sub agents: send the transcript, execute any tool
 * calls, and repeat until the model replies without tools (or the iteration cap
 * is hit). Deliberately independent of `ChatSessionService` — no persistence,
 * approvals, compaction, or titles; the caller owns all of that.
 */
export async function runSubAgent(
  input: RunSubAgentInput
): Promise<RunSubAgentResult> {
  const maxIterations = input.maxIterations ?? DEFAULT_SUB_AGENT_MAX_ITERATIONS;
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

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    throwIfAborted(input.signal);

    const response = await input.provider.sendChat({
      model: input.model,
      sessionId: input.sessionId,
      messages: [systemMessage, ...messages],
      ...(toolDefinitions.length > 0 ? { tools: toolDefinitions } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      // Streaming (the tokens are discarded — nobody watches a sub agent type)
      // keeps HTTP providers on their streaming path, which has no fixed
      // response deadline. The non-streaming path rides `requestJson`'s hard
      // timeout, which a long reasoning step (a big review) can easily exceed.
      onToken: () => {},
    });

    throwIfAborted(input.signal);

    if (response.usage) {
      usage = usage ? sumUsage(usage, response.usage) : response.usage;
    }

    const toolCalls = response.toolCalls ?? [];
    if (toolCalls.length === 0) {
      append(createMessage(MessageRole.Assistant, response.content));
      return {
        summary: response.content,
        messages,
        toolUseCount,
        ...(usage ? { usage } : {}),
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

  // Cap reached: return whatever the transcript holds rather than looping on.
  const summary = `Sub agent stopped after reaching the ${maxIterations}-iteration limit without finishing.`;
  append(createMessage(MessageRole.Assistant, summary));
  return { summary, messages, toolUseCount, ...(usage ? { usage } : {}) };
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
