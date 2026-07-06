import { randomUUID } from 'node:crypto';
import type {
  query,
  McpServerConfig,
  Options,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
  ReasoningEffort,
  type ChatRequest,
  type ChatResult,
  type ModelInfo,
  type ProviderClient,
  type TokenUsage,
} from '@core/ports/chat-model';
import { ProviderId } from '@core/ports/provider-catalog';
import {
  renderMessageContentForModel,
  type ChatMessage,
  type ToolCall,
} from '@core/domain/message';
import type { ToolDefinition, ToolResult } from '@core/ports/tool';

/**
 * Claude subscription provider backed by the official Claude Agent SDK.
 *
 * Anthropic's Consumer Terms prohibit using Pro/Max OAuth tokens against the
 * Messages API from third-party clients, but explicitly allow third-party apps
 * built on the Agent SDK that authenticate through the user's own Claude Code
 * login. This provider therefore never touches credentials: the SDK spawns the
 * official Claude Code runtime, which reads the user's `claude /login` session
 * (or `CLAUDE_CODE_OAUTH_TOKEN`) itself.
 *
 * Bridging model: justcode's agent loop owns tool execution — `sendChat`
 * returns tool calls, the engine runs them, and the next `sendChat` carries the
 * results. The Agent SDK, however, runs its own loop and expects to execute
 * tools itself. The bridge reconciles the two by disabling every Claude Code
 * built-in tool and advertising justcode's tools through an in-process MCP
 * server whose call handler *blocks*: when the model invokes a tool, the
 * handler parks the call, `sendChat` returns it to the engine, and the promise
 * is resolved with the engine's result on the next `sendChat` — at which point
 * the SDK session resumes as if the tool had simply been slow.
 */

/** MCP server name; the SDK prefixes tool names as `mcp__<name>__<tool>`. */
const MCP_SERVER_NAME = 'justcode';
const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

/** A tool invocation parked between the MCP handler and the engine. */
interface PendingToolCall {
  call: ToolCall;
  resolve: (result: ToolResult) => void;
}

/** One value pulled from the session's SDK stream, or a parked tool call. */
type TurnEvent =
  | { kind: 'message'; message: SDKMessage | undefined }
  | { kind: 'tool'; pending: PendingToolCall };

/**
 * An unbounded push queue exposed as the AsyncIterable the SDK consumes as its
 * streaming prompt input.
 */
class UserMessageStream implements AsyncIterable<SDKUserMessage> {
  private readonly queue: SDKUserMessage[] = [];
  private waiter: ((value: IteratorResult<SDKUserMessage>) => void) | null =
    null;
  private closed = false;

  public push(message: SDKUserMessage): void {
    if (this.closed) return;
    const waiter = this.waiter;
    if (waiter) {
      this.waiter = null;
      waiter({ value: message, done: false });
      return;
    }
    this.queue.push(message);
  }

  public close(): void {
    this.closed = true;
    const waiter = this.waiter;
    if (waiter) {
      this.waiter = null;
      waiter({ value: undefined as never, done: true });
    }
  }

  public [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        const queued = this.queue.shift();
        if (queued) return Promise.resolve({ value: queued, done: false });
        if (this.closed)
          return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve) => {
          this.waiter = resolve;
        });
      },
    };
  }
}

/** A live Claude Code session bridged to one justcode chat session. */
class SessionBridge {
  public readonly input = new UserMessageStream();
  public query!: Query;
  public model: string;
  /** id of the last conversation message already forwarded into the session. */
  public lastSeenMessageId: string | undefined;
  /** Tool calls the model has made that the engine hasn't answered yet. */
  public readonly pendingTools = new Map<string, PendingToolCall>();
  /** Tool invocations parked by the MCP handler, awaiting pickup by sendChat. */
  public readonly parkedToolCalls: PendingToolCall[] = [];
  private toolWake: (() => void) | null = null;
  /** The stream `next()` in flight, kept across sendChat boundaries. */
  private inflightNext: Promise<IteratorResult<SDKMessage, void>> | null = null;
  /** Names advertised on the MCP server, to detect tool-set changes. */
  public advertisedToolNames = '';
  /** Latest definitions served by the MCP server's ListTools handler. */
  public toolDefinitions: ToolDefinition[] = [];

  public constructor(model: string) {
    this.model = model;
  }

  /** Called by the MCP tool handler: park the call and wake `nextEvent`. */
  public parkToolCall(pending: PendingToolCall): void {
    this.pendingTools.set(pending.call.id, pending);
    this.parkedToolCalls.push(pending);
    this.toolWake?.();
  }

  /**
   * Resolves with the next turn event: a parked tool call wins over stream
   * progress so `sendChat` hands the invocation to the engine as soon as the
   * model asks for it. The in-flight stream read is stashed and reused by the
   * next call — an AsyncGenerator can't have two concurrent `next()`s. Parked
   * calls always live in `parkedToolCalls` (the wake callback only signals),
   * so a call landing in the same tick the stream wins is never lost.
   */
  public async nextEvent(): Promise<TurnEvent> {
    const parked = this.parkedToolCalls.shift();
    if (parked) return { kind: 'tool', pending: parked };

    this.inflightNext ??= this.query.next();
    const toolArrival = new Promise<void>((resolve) => {
      this.toolWake = resolve;
    });
    const streamArrival = this.inflightNext.then(
      (result): TurnEvent => ({
        kind: 'message',
        message: result.done ? undefined : result.value,
      })
    );

    const event = await Promise.race([toolArrival, streamArrival]);
    this.toolWake = null;
    const arrived = this.parkedToolCalls.shift();
    if (arrived) return { kind: 'tool', pending: arrived };
    if (event && event.kind === 'message') {
      this.inflightNext = null;
      return event;
    }
    // The wake fired but another consumer drained the queue — recurse to
    // re-arm; sendChat calls are sequential per session so this is rare.
    return this.nextEvent();
  }
}

export interface ClaudeAgentProviderOptions {
  /**
   * Factory for the SDK's `query` entry point — injectable so tests can drive
   * the bridge without spawning the real Claude Code runtime.
   */
  createQuery?: typeof query;
}

/**
 * The Agent SDK is ESM-only and resolves its bundled CLI from
 * `import.meta.url` at module-evaluation time, which breaks in CJS bundles
 * (e.g. the VS Code extension host, where it evaluates to undefined and
 * crashes extension activation). Loading it lazily via dynamic import keeps
 * the catalog importable everywhere; environments that can't load the SDK
 * only fail if the user actually connects the Claude Code provider.
 */
let sdkModulePromise:
  | Promise<typeof import('@anthropic-ai/claude-agent-sdk')>
  | undefined;

async function loadQuery(): Promise<typeof query> {
  sdkModulePromise ??= import('@anthropic-ai/claude-agent-sdk');
  try {
    return (await sdkModulePromise).query;
  } catch (error) {
    sdkModulePromise = undefined;
    const detail = error instanceof Error ? ` (${error.message})` : '';
    throw new Error(
      `The Claude Agent SDK could not be loaded in this environment${detail}. ` +
        'The Claude Code provider needs a runtime that can load ES modules.'
    );
  }
}

export class ClaudeAgentProvider implements ProviderClient {
  public readonly providerId = ProviderId.ClaudeCode;
  private readonly sessions = new Map<string, SessionBridge>();
  private readonly injectedCreateQuery: typeof query | undefined;

  public constructor(options: ClaudeAgentProviderOptions = {}) {
    this.injectedCreateQuery = options.createQuery;
  }

  /** The injected test double, or the lazily-imported real SDK entry point. */
  private async resolveCreateQuery(): Promise<typeof query> {
    return this.injectedCreateQuery ?? loadQuery();
  }

  public async sendChat(request: ChatRequest): Promise<ChatResult> {
    const sessionKey = request.sessionId ?? 'default';
    let bridge = this.sessions.get(sessionKey);
    if (!bridge) {
      bridge = this.startSession(request, await this.resolveCreateQuery());
      this.sessions.set(sessionKey, bridge);
    } else {
      await this.syncSessionOptions(bridge, request);
    }

    this.forwardNewMessages(bridge, request);

    const abort = (): void => {
      // Interrupt the in-flight turn; the session stays alive for resumption.
      void bridge.query.interrupt().catch(() => {});
    };
    request.signal?.addEventListener('abort', abort, { once: true });
    try {
      return await this.collectTurn(bridge, request);
    } finally {
      request.signal?.removeEventListener('abort', abort);
    }
  }

  public async listModels(): Promise<ModelInfo[]> {
    // supportedModels is a control request, so it needs a live session; open a
    // throwaway streaming-input query (which never sends a prompt) and close it.
    const input = new UserMessageStream();
    const createQuery = await this.resolveCreateQuery();
    const probe = createQuery({
      prompt: input,
      options: { tools: [], settingSources: [] },
    });
    try {
      const models = await probe.supportedModels();
      return models.map((model) => ({
        id: model.value,
        displayName: model.displayName,
        providerId: this.providerId,
        ...(model.supportsEffort && model.supportedEffortLevels?.length
          ? {
              reasoning: {
                effortLevels: model.supportedEffortLevels.map(
                  (level) => level as ReasoningEffort
                ),
                mandatory: false,
              },
            }
          : {}),
      }));
    } finally {
      input.close();
      await probe.return(undefined).catch(() => {});
    }
  }

  public getDefaultModel(): string | undefined {
    return undefined;
  }

  /** Tears down every live Claude Code session this provider started. */
  public async dispose(): Promise<void> {
    for (const bridge of this.sessions.values()) {
      bridge.input.close();
      await bridge.query.return(undefined).catch(() => {});
    }
    this.sessions.clear();
  }

  private startSession(
    request: ChatRequest,
    createQuery: typeof query
  ): SessionBridge {
    const bridge = new SessionBridge(request.model);
    bridge.toolDefinitions = request.tools ?? [];
    bridge.advertisedToolNames = toolNamesKey(request.tools);

    const systemMessage = request.messages.find((m) => m.role === 'system');
    const options: Options = {
      model: request.model,
      // justcode owns the agent loop: no Claude Code built-ins, no user
      // settings/hooks/CLAUDE.md — the engine already provides all context.
      tools: [],
      settingSources: [],
      mcpServers: {
        [MCP_SERVER_NAME]: this.createMcpServerConfig(bridge),
      },
      // The engine approves tool calls with the user before dispatching them,
      // so the CLI-side permission gate would only double-prompt.
      canUseTool: async (_toolName, input) => ({
        behavior: 'allow',
        updatedInput: input,
      }),
      includePartialMessages: true,
      ...(systemMessage ? { systemPrompt: systemMessage.content } : {}),
      ...effortOptions(request.reasoningEffort),
    };

    bridge.query = createQuery({ prompt: bridge.input, options });
    return bridge;
  }

  /** Applies mid-session changes (model, advertised tools) to a live bridge. */
  private async syncSessionOptions(
    bridge: SessionBridge,
    request: ChatRequest
  ): Promise<void> {
    if (bridge.model !== request.model) {
      await bridge.query.setModel(request.model);
      bridge.model = request.model;
    }
    const namesKey = toolNamesKey(request.tools);
    if (bridge.advertisedToolNames !== namesKey) {
      // justcode lazily expands the advertised tool set mid-conversation.
      // Re-registering the MCP server makes the CLI re-list its tools.
      bridge.toolDefinitions = request.tools ?? [];
      bridge.advertisedToolNames = namesKey;
      await bridge.query.setMcpServers({
        [MCP_SERVER_NAME]: this.createMcpServerConfig(bridge),
      });
    }
  }

  /**
   * An in-process MCP server exposing justcode's tools. The low-level Server
   * is used (rather than the SDK's zod-based `tool()` helper) because justcode
   * tool definitions carry raw JSON Schemas, which MCP accepts natively.
   */
  private createMcpServerConfig(bridge: SessionBridge): McpServerConfig {
    const server = new Server(
      { name: MCP_SERVER_NAME, version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: bridge.toolDefinitions.map((definition) => ({
        name: definition.name,
        description: definition.description,
        inputSchema: definition.parameters as {
          type: 'object';
          [key: string]: unknown;
        },
      })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (call) => {
      const result = await new Promise<ToolResult>((resolve) => {
        bridge.parkToolCall({
          call: {
            id: `call_${randomUUID()}`,
            name: call.params.name,
            arguments: JSON.stringify(call.params.arguments ?? {}),
          },
          resolve,
        });
      });
      return {
        content: [{ type: 'text' as const, text: result.content }],
        ...(result.isError ? { isError: true } : {}),
      };
    });
    // The Agent SDK connects the instance to its own in-process transport; the
    // config type nominally wants the high-level McpServer wrapper, but only
    // `.connect(transport)` is used, which both classes implement.
    return {
      type: 'sdk',
      name: MCP_SERVER_NAME,
      instance: server,
    } as unknown as McpServerConfig;
  }

  /**
   * Feeds the messages this request added since the last call into the live
   * session: tool results settle parked MCP handlers, user messages queue as
   * prompt input. Assistant messages are skipped — the session already has
   * them. On a brand-new session with prior history (a resumed conversation),
   * everything before the last user message is folded into one context block.
   */
  private forwardNewMessages(
    bridge: SessionBridge,
    request: ChatRequest
  ): void {
    const conversation = request.messages.filter((m) => m.role !== 'system');
    const lastSeenIndex = bridge.lastSeenMessageId
      ? conversation.findIndex((m) => m.id === bridge.lastSeenMessageId)
      : -1;
    let fresh = conversation.slice(lastSeenIndex + 1);

    if (lastSeenIndex === -1 && fresh.length > 1) {
      // New session over an existing conversation (resumed after a restart or
      // a provider switch): replay what the session missed as context rather
      // than dropping it. Only the final user message triggers the turn.
      const lastUserIndex = findLastUserIndex(fresh);
      const preamble = fresh.slice(0, lastUserIndex);
      fresh = fresh.slice(lastUserIndex);
      if (preamble.length > 0) {
        bridge.input.push(
          userMessage(
            `Conversation so far (for context):\n\n${renderTranscript(preamble)}`,
            { shouldQuery: false }
          )
        );
      }
    }

    let advancedSession = false;
    for (const message of fresh) {
      if (message.role === 'tool') {
        const pending = message.toolCallId
          ? bridge.pendingTools.get(message.toolCallId)
          : undefined;
        if (pending) {
          bridge.pendingTools.delete(message.toolCallId ?? '');
          pending.resolve({
            content: message.content,
            ...(message.isError ? { isError: true } : {}),
          });
          advancedSession = true;
        }
        continue;
      }
      if (message.role !== 'user') continue;
      bridge.input.push(chatMessageToSdkUserMessage(message));
      advancedSession = true;
    }

    // Nothing above moved the session forward (e.g. a restored conversation
    // whose tail is an orphaned tool result with no matching parked handler).
    // Push a synthetic user turn so `collectTurn` doesn't wait forever.
    if (!advancedSession && fresh.length > 0) {
      bridge.input.push(
        userMessage(
          `The conversation resumed with these messages:\n\n${renderTranscript(fresh)}\n\nContinue.`
        )
      );
    }

    const lastMessage = conversation[conversation.length - 1];
    if (lastMessage) bridge.lastSeenMessageId = lastMessage.id;
  }

  /**
   * Consumes session events until this round completes: either the model
   * invoked a tool (returned to the engine for execution) or the turn finished
   * with a final result.
   */
  private async collectTurn(
    bridge: SessionBridge,
    request: ChatRequest
  ): Promise<ChatResult> {
    let content = '';
    let usage: TokenUsage | undefined;

    for (;;) {
      if (request.signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      const event = await bridge.nextEvent();

      if (event.kind === 'tool') {
        return {
          content,
          toolCalls: [
            {
              ...event.pending.call,
              name: stripToolPrefix(event.pending.call.name),
            },
          ],
        };
      }

      const message = event.message;
      if (!message) {
        // Stream ended without a result — the CLI process exited (logout,
        // crash, or interrupt teardown). Drop the bridge so the next request
        // starts a fresh session instead of writing into a dead stream.
        this.dropBridge(bridge);
        if (request.signal?.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
        throw new Error(
          "Provider 'claude-code' ended the session unexpectedly. " +
            'Check that Claude Code is installed and signed in (`claude /login`).'
        );
      }

      if (message.type === 'stream_event') {
        if (message.parent_tool_use_id) continue;
        const streamEvent = message.event as {
          type?: string;
          delta?: { type?: string; text?: string; thinking?: string };
        };
        if (streamEvent.type === 'content_block_delta') {
          if (
            streamEvent.delta?.type === 'text_delta' &&
            streamEvent.delta.text
          ) {
            content += streamEvent.delta.text;
            request.onToken?.(streamEvent.delta.text);
          } else if (
            streamEvent.delta?.type === 'thinking_delta' &&
            streamEvent.delta.thinking
          ) {
            request.onThinkingToken?.(streamEvent.delta.thinking);
          }
        }
        continue;
      }

      if (message.type === 'result') {
        if (message.usage) {
          usage = {
            inputTokens:
              (message.usage.input_tokens ?? 0) +
              (message.usage.cache_read_input_tokens ?? 0) +
              (message.usage.cache_creation_input_tokens ?? 0),
            outputTokens: message.usage.output_tokens ?? 0,
            cachedTokens: message.usage.cache_read_input_tokens ?? 0,
            // Subscription usage draws from plan limits, not pay-as-you-go;
            // the SDK still reports the equivalent API cost.
            cost: message.total_cost_usd,
          };
        }
        if (request.signal?.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
        if (message.subtype !== 'success') {
          const detail =
            'errors' in message && message.errors.length
              ? ` ${message.errors.join('; ')}`
              : '';
          throw new Error(
            `Provider 'claude-code' failed (${message.subtype}).${detail}`
          );
        }
        const finalContent = content.trim() ? content : message.result;
        if (!finalContent.trim()) {
          throw new Error("Provider 'claude-code' returned an empty response.");
        }
        return {
          content: finalContent,
          ...(usage ? { usage } : {}),
        };
      }

      // Everything else (init/system/status/assistant echoes) is bookkeeping;
      // text and thinking already arrived via stream events.
    }
  }

  private dropBridge(bridge: SessionBridge): void {
    for (const [key, value] of this.sessions) {
      if (value === bridge) this.sessions.delete(key);
    }
    bridge.input.close();
  }
}

function toolNamesKey(tools: ToolDefinition[] | undefined): string {
  return (tools ?? [])
    .map((tool) => tool.name)
    .sort()
    .join(',');
}

function stripToolPrefix(name: string): string {
  return name.startsWith(MCP_TOOL_PREFIX)
    ? name.slice(MCP_TOOL_PREFIX.length)
    : name;
}

function findLastUserIndex(messages: ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === 'user') return index;
  }
  return messages.length - 1;
}

/** Renders prior turns as plain text for the resumed-session context block. */
function renderTranscript(messages: ChatMessage[]): string {
  return messages
    .map((message) => {
      if (message.role === 'tool') {
        return `[tool result: ${message.name ?? 'unknown'}]\n${message.content}`;
      }
      const calls = message.toolCalls
        ?.map((call) => `[called tool: ${call.name}(${call.arguments})]`)
        .join('\n');
      const body = renderMessageContentForModel(message);
      return `${message.role}:\n${[body, calls].filter(Boolean).join('\n')}`;
    })
    .join('\n\n');
}

function userMessage(
  text: string,
  extra: Partial<SDKUserMessage> = {}
): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
    parent_tool_use_id: null,
    ...extra,
  };
}

function chatMessageToSdkUserMessage(message: ChatMessage): SDKUserMessage {
  const blocks: Array<Record<string, unknown>> = [];
  const text = renderMessageContentForModel(message);
  if (text.trim()) blocks.push({ type: 'text', text });
  for (const image of message.images ?? []) {
    blocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: image.mediaType,
        data: image.data,
      },
    });
  }
  if (blocks.length === 0) blocks.push({ type: 'text', text: message.content });
  return {
    type: 'user',
    message: {
      role: 'user',
      content: blocks as never,
    },
    parent_tool_use_id: null,
  };
}

/** Maps justcode's normalized reasoning choice onto SDK thinking options. */
function effortOptions(
  effort: ChatRequest['reasoningEffort']
): Pick<Options, 'thinking' | 'effort'> {
  if (!effort) return {};
  if (effort === 'off') return { thinking: { type: 'disabled' } };
  return { effort };
}
