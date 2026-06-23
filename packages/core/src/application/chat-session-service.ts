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
import type {
  ModelInfo,
  ProviderClient,
  TokenUsage,
} from '@core/ports/chat-model';
import type { ConversationRepository } from '@core/ports/conversation-repository';
import type { Tool, ToolInvocationView, ToolResult } from '@core/ports/tool';
import type { ToolRegistry } from '@core/application/tool-registry';
import { buildSystemPrompt } from '@core/application/system-prompt';

/** Hard cap on tool round-trips per user message, to bound runaway loops. */
const MAX_TOOL_STEPS = 12;

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
  view: ToolInvocationView;
  result?: ToolResult;
}

export interface SubmitMessageInput {
  conversation: Conversation;
  model: string;
  content: string;
  attachments?: MessageAttachment[];
  onToken?: (token: string) => void;
  onThinkingToken?: (token: string) => void;
  /** Asked before a tool that `requiresApproval` runs. Absent → auto-approved. */
  requestApproval?: (request: ToolApprovalRequest) => Promise<boolean>;
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
}

export class ChatSessionService {
  private provider: ProviderClient;
  private readonly toolRegistry: ToolRegistry | undefined;
  private readonly workspaceRoot: string;

  public constructor(
    private readonly repository: ConversationRepository,
    provider: ProviderClient,
    options: ChatSessionOptions = {}
  ) {
    this.provider = provider;
    this.toolRegistry = options.toolRegistry;
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
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
    const systemMessage = createMessage(
      'system',
      buildSystemPrompt(toolDefinitions)
    );

    // `working` is the persisted history plus everything produced this turn.
    const working: ChatMessage[] = [
      ...input.conversation.messages,
      userMessage,
    ];
    let usage: TokenUsage | undefined;
    let reply = '';

    for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
      const response = await this.provider.sendChat({
        model: input.model,
        messages: [systemMessage, ...working],
        ...(toolDefinitions.length ? { tools: toolDefinitions } : {}),
        ...(input.onToken ? { onToken: input.onToken } : {}),
        ...(input.onThinkingToken
          ? { onThinkingToken: input.onThinkingToken }
          : {}),
      });

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
    const tool = this.toolRegistry?.get(call.name);
    if (!tool) {
      return { content: `Unknown tool: ${call.name}`, isError: true };
    }

    const view = describeTool(tool, call.arguments);
    input.onToolActivity?.({ phase: 'start', toolName: call.name, view });

    let result: ToolResult;
    const approved = await this.resolveApproval(tool, view, call, input);
    if (!approved) {
      result = { content: 'The user rejected this tool call.', isError: true };
    } else {
      try {
        result = await tool.execute(call.arguments, {
          workspaceRoot: this.workspaceRoot,
        });
      } catch (error: unknown) {
        result = {
          content: `Tool failed: ${errorMessage(error)}`,
          isError: true,
        };
      }
    }

    input.onToolActivity?.({ phase: 'end', toolName: call.name, view, result });
    return result;
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

    return input.requestApproval({ toolName: call.name, ...view });
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

function describeTool(tool: Tool, rawArguments: string): ToolInvocationView {
  try {
    return tool.describe(rawArguments);
  } catch {
    return { title: tool.definition.name };
  }
}

function sumUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cachedTokens: left.cachedTokens + right.cachedTokens,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createEmptyConversation(sessionId: string): Conversation {
  return createConversation(sessionId);
}
