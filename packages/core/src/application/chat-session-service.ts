import {
  createConversation,
  type Conversation,
} from '@core/domain/conversation';
import {
  createMessage,
  type ChatMessage,
  type MessageAttachment,
  type ToolCall,
} from '@core/domain/message';
import {
  ToolsUnsupportedError,
  type ModelInfo,
  type ProviderClient,
  type TokenUsage,
} from '@core/ports/chat-model';
import type { ConversationRepository } from '@core/ports/conversation-repository';
import type { ConversationSummary } from '@core/ports/conversation-repository';
import type {
  Tool,
  ToolExecutionContext,
  ToolInvocationView,
  ToolResult,
  UserQuestionRequest,
} from '@core/ports/tool';
import type { WorkspaceFilePort } from '@core/ports/workspace-file-port';
import type { ToolRegistry } from '@core/application/tool-registry';
import {
  DEFAULT_SYSTEM_PROMPT,
  buildSystemPrompt,
} from '@core/application/system-prompt';

/** Hard cap on tool round-trips per user message, to bound runaway loops. */
const MAX_TOOL_STEPS = 12;
const SESSION_TITLE_SYSTEM_PROMPT = [
  'You are a session name generator.',
  'You output ONLY a short session title. Nothing else.',
  'Generate a brief name that would help the user find this conversation later.',
  'No explanations or quotes.',
].join(' ');

export interface StartSessionInput {
  sessionId: string;
  requestedModel?: string;
}

export interface StartSessionResult {
  conversation: Conversation;
  activeModel: string;
  availableModels: ModelInfo[];
}

export interface ToolApprovalRequest extends ToolInvocationView {
  toolName: string;
}

export interface ToolActivityEvent {
  phase: 'start' | 'end';
  toolName: string;
  /** The tool call's id, so the UI can match a `start` event to its `end`. */
  toolCallId: string;
  /** Raw JSON arguments of the call, so the UI can render it faithfully. */
  arguments: string;
  view: ToolInvocationView;
  result?: ToolResult;
}

export interface SubmitMessageInput {
  conversation: Conversation;
  model: string;
  content: string;
  attachments?: MessageAttachment[];
  signal?: AbortSignal;
  onToken?: (token: string) => void;
  onThinkingToken?: (token: string) => void;
  /** Asked before a tool that `requiresApproval` runs. Absent → auto-approved. */
  requestApproval?: (request: ToolApprovalRequest) => Promise<boolean>;
  /** Lets a tool prompt the user for input mid-turn (e.g. the question tool). */
  requestUserInput?: (request: UserQuestionRequest) => Promise<string>;
  onToolActivity?: (event: ToolActivityEvent) => void;
}

export interface SubmitMessageResult {
  conversation: Conversation;
  reply: string;
  usage?: TokenUsage;
}

export interface ChatSessionOptions {
  toolRegistry?: ToolRegistry;
  workspaceRoot?: string;
  workspaceFiles?: WorkspaceFilePort;
  systemPrompt?: string;
  /**
   * Whether to also list the available tools (with their descriptions) in the
   * prose system prompt. Tools are always advertised to the provider via
   * proper function-calling regardless of this flag — this only controls the
   * redundant prose listing. Defaults to false.
   */
  describeToolsInSystemPrompt?: boolean;
}

export class ChatSessionService {
  private provider: ProviderClient;
  private readonly toolRegistry: ToolRegistry | undefined;
  private readonly workspaceRoot: string;
  private readonly workspaceFiles: WorkspaceFilePort | undefined;
  private readonly systemPrompt: string;
  private readonly describeToolsInSystemPrompt: boolean;
  /** Models that rejected tools once; we send their requests chat-only after. */
  private readonly toolUnsupportedModels = new Set<string>();

  public constructor(
    private readonly repository: ConversationRepository,
    provider: ProviderClient,
    options: ChatSessionOptions = {}
  ) {
    this.provider = provider;
    this.toolRegistry = options.toolRegistry;
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.workspaceFiles = options.workspaceFiles;
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.describeToolsInSystemPrompt =
      options.describeToolsInSystemPrompt ?? false;
  }

  public switchProvider(provider: ProviderClient): void {
    this.provider = provider;
  }

  public async startSession(
    input: StartSessionInput
  ): Promise<StartSessionResult> {
    const conversation = await this.repository.load(input.sessionId);
    const availableModels = await this.provider.listModels();
    const activeModel = this.resolveModel(
      input.requestedModel,
      availableModels
    );

    return {
      conversation,
      activeModel,
      availableModels,
    };
  }

  public async clearSession(sessionId: string): Promise<Conversation> {
    await this.repository.clear(sessionId);
    return createConversation(sessionId);
  }

  public async listSessions(): Promise<ConversationSummary[]> {
    return this.repository.list();
  }

  public async submitMessage(
    input: SubmitMessageInput
  ): Promise<SubmitMessageResult> {
    const trimmedContent = input.content.trim();

    if (!trimmedContent) {
      throw new Error('Message content cannot be empty.');
    }

    const userMessage = createMessage(
      'user',
      trimmedContent,
      new Date(),
      input.attachments
    );

    const toolDefinitions = this.toolRegistry?.definitions() ?? [];
    const projectInstructions = await this.loadProjectInstructions();
    // Models known not to support tools are sent chat-only from the start; the
    // tool section is also dropped from the system prompt so we don't advertise
    // tools the model can't call.
    let toolsEnabled =
      toolDefinitions.length > 0 &&
      !this.toolUnsupportedModels.has(input.model);

    // `working` is the persisted history plus everything produced this turn.
    const working: ChatMessage[] = [
      ...input.conversation.messages,
      userMessage,
    ];
    let usage: TokenUsage | undefined;
    let reply = '';

    for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
      throwIfAborted(input.signal);
      const systemMessage = createMessage(
        'system',
        buildSystemPrompt(
          this.systemPrompt,
          this.workspaceRoot,
          toolsEnabled && this.describeToolsInSystemPrompt
            ? toolDefinitions
            : [],
          projectInstructions
        )
      );

      let response;
      try {
        response = await this.provider.sendChat({
          model: input.model,
          messages: [systemMessage, ...working],
          ...(toolsEnabled ? { tools: toolDefinitions } : {}),
          ...(input.onToken ? { onToken: input.onToken } : {}),
          ...(input.onThinkingToken
            ? { onThinkingToken: input.onThinkingToken }
            : {}),
          ...(input.signal ? { signal: input.signal } : {}),
        });
      } catch (error) {
        // The model doesn't support tools: remember it, drop tools, and retry
        // this step in chat-only mode.
        if (toolsEnabled && error instanceof ToolsUnsupportedError) {
          this.toolUnsupportedModels.add(input.model);
          toolsEnabled = false;
          step -= 1;
          continue;
        }
        throw error;
      }

      throwIfAborted(input.signal);

      if (response.usage) {
        usage = usage ? sumUsage(usage, response.usage) : response.usage;
      }

      const toolCalls = response.toolCalls ?? [];
      if (response.content) {
        reply = response.content;
      }

      if (toolCalls.length === 0) {
        working.push(createMessage('assistant', response.content));
        break;
      }

      working.push(
        createMessage('assistant', response.content, new Date(), undefined, {
          toolCalls,
        })
      );

      for (const call of toolCalls) {
        const toolResult = await this.runToolCall(call, input);
        working.push(
          createMessage('tool', toolResult.content, new Date(), undefined, {
            toolCallId: call.id,
            name: call.name,
          })
        );
      }
    }

    const updatedConversation: Conversation = {
      ...input.conversation,
      messages: working,
      updatedAt: new Date().toISOString(),
    };

    await this.repository.save(updatedConversation);

    if (!updatedConversation.title) {
      const generatedTitle = await this.generateSessionTitle({
        model: input.model,
        userMessage: trimmedContent,
      });

      if (generatedTitle) {
        updatedConversation.title = generatedTitle;
        await this.repository.save(updatedConversation);
      }
    }

    return {
      conversation: updatedConversation,
      reply,
      ...(usage ? { usage } : {}),
    };
  }

  private async runToolCall(
    call: ToolCall,
    input: SubmitMessageInput
  ): Promise<ToolResult> {
    throwIfAborted(input.signal);
    const tool = this.toolRegistry?.get(call.name);
    if (!tool) {
      return { content: `Unknown tool: ${call.name}`, isError: true };
    }

    const view = await describeTool(tool, call.arguments, {
      workspaceRoot: this.workspaceRoot,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    input.onToolActivity?.({
      phase: 'start',
      toolName: call.name,
      toolCallId: call.id,
      arguments: call.arguments,
      view,
    });

    let result: ToolResult;
    const approved = await this.resolveApproval(tool, view, call, input);
    if (!approved) {
      result = { content: 'The user rejected this tool call.', isError: true };
    } else {
      throwIfAborted(input.signal);
      // Bridge a tool's `askUser` to the host's prompt, and make a cancellation
      // (abort) reject the pending question so the loop can unwind.
      const requestUserInput = input.requestUserInput;
      const askUser = requestUserInput
        ? (request: UserQuestionRequest): Promise<string> =>
            awaitWithAbort(requestUserInput(request), input.signal)
        : undefined;
      try {
        result = await tool.execute(call.arguments, {
          workspaceRoot: this.workspaceRoot,
          ...(input.signal ? { signal: input.signal } : {}),
          ...(askUser ? { askUser } : {}),
        });
        throwIfAborted(input.signal);
      } catch (error: unknown) {
        if (isAbortError(error)) {
          throw error;
        }
        result = {
          content: `Tool failed: ${errorMessage(error)}`,
          isError: true,
        };
      }
    }

    input.onToolActivity?.({
      phase: 'end',
      toolName: call.name,
      toolCallId: call.id,
      arguments: call.arguments,
      view,
      result,
    });
    return result;
  }

  private async loadProjectInstructions(): Promise<string | undefined> {
    if (!this.workspaceFiles) {
      return undefined;
    }

    try {
      const agentsMd = await this.workspaceFiles.readFile('AGENTS.md');
      const trimmed = agentsMd.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    } catch {
      return undefined;
    }
  }

  private async generateSessionTitle(input: {
    model: string;
    userMessage: string;
  }): Promise<string | undefined> {
    try {
      const result = await this.provider.sendChat({
        model: input.model,
        messages: [
          createMessage('system', SESSION_TITLE_SYSTEM_PROMPT),
          createMessage('user', input.userMessage),
        ],
      });

      return normalizeSessionTitle(result.content);
    } catch {
      return undefined;
    }
  }

  private async resolveApproval(
    tool: Tool,
    view: ToolInvocationView,
    call: ToolCall,
    input: SubmitMessageInput
  ): Promise<boolean> {
    if (!tool.requiresApproval || !input.requestApproval) {
      return true;
    }

    return awaitWithAbort(
      input.requestApproval({ toolName: call.name, ...view }),
      input.signal
    );
  }

  private resolveModel(
    requestedModel: string | undefined,
    availableModels: ModelInfo[]
  ): string {
    if (requestedModel) {
      return requestedModel;
    }

    const providerDefault = this.provider.getDefaultModel();
    if (providerDefault) {
      return providerDefault;
    }

    const firstModel = availableModels[0]?.id;
    if (firstModel) {
      return firstModel;
    }

    throw new Error(
      `No models are available for provider '${this.provider.providerId}'.`
    );
  }
}

async function describeTool(
  tool: Tool,
  rawArguments: string,
  context: ToolExecutionContext
): Promise<ToolInvocationView> {
  let view: ToolInvocationView;
  try {
    view = tool.describe(rawArguments);
  } catch {
    view = { title: tool.definition.name };
  }

  // Enrich with a before/after diff when the tool supports it. A failure here
  // is non-fatal — the call still runs, just without the colored preview.
  if (tool.previewDiff) {
    try {
      const diff = await tool.previewDiff(rawArguments, context);
      if (diff) {
        view = { ...view, diff };
      }
    } catch {
      // Ignore: previewing a diff must never block the actual call.
    }
  }

  return view;
}

function sumUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cachedTokens: left.cachedTokens + right.cachedTokens,
    ...(left.cost !== undefined || right.cost !== undefined
      ? { cost: (left.cost ?? 0) + (right.cost ?? 0) }
      : {}),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function awaitWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined
): Promise<T> {
  if (!signal) {
    return promise;
  }

  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(createAbortError());
    };

    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

function createAbortError(): Error {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function normalizeSessionTitle(content: string): string | undefined {
  const title = content.replace(/[\r\n]+/g, ' ').trim();
  return title || undefined;
}

export function createEmptyConversation(sessionId: string): Conversation {
  return createConversation(sessionId);
}
