import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
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
  type ChatRequest,
  type ChatResult,
  type ModelInfo,
  type ProviderClient,
  type ProviderUsageSummary,
  type ProviderUsageWindow,
  type TokenUsage,
} from '@core/ports/chat-model';
import { ReasoningDisabled } from '@core/ports/chat-model';
import { ProviderId } from '@core/ports/provider-catalog';
import {
  MessageRole,
  renderMessageContentForModel,
  type ChatMessage,
  type ToolCall,
} from '@core/domain/message';
import type { ToolDefinition, ToolResult } from '@core/ports/tool';
import { ToolName } from '@core/domain/tool-name';
import { logRequestResponse } from '@core/application/debug-log';
import { normalizeEffortLevels } from '@providers/http/reasoning';
import { AgentSendMode } from '@providers/agent-send-mode';

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

/**
 * Batch window for parallel `task` calls (see collectTurn): after the first
 * task invocation parks, keep collecting siblings while they arrive within
 * each quiet step, up to the cap. Sub agent runs take tens of seconds, so the
 * added latency is negligible next to running them serially.
 */
const TASK_BATCH_QUIET_MS = 150;
const TASK_BATCH_MAX_WAIT_MS = 1500;

/** A tool invocation parked between the MCP handler and the engine. */
interface PendingToolCall {
  call: ToolCall;
  resolve: (result: ToolResult) => void;
}

/** What `nextEvent` yielded: stream progress, or a parked tool invocation. */
enum TurnEventKind {
  Message = 'message',
  Tool = 'tool',
}

/** One value pulled from the session's SDK stream, or a parked tool call. */
type TurnEvent =
  | { kind: TurnEventKind.Message; message: SDKMessage | undefined }
  | { kind: TurnEventKind.Tool; pending: PendingToolCall };

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

  /**
   * Serializes turns: an aborted turn's collector keeps running (the engine
   * abandons the promise, but the interrupt's result still has to be consumed
   * off the stream) and the next turn must not race it for events.
   */
  private turnChain: Promise<void> = Promise.resolve();

  public constructor(model: string) {
    this.model = model;
  }

  /** Runs `turn` after every previously started turn has fully settled. */
  public runExclusive<T>(turn: () => Promise<T>): Promise<T> {
    const result = this.turnChain.then(turn, turn);
    this.turnChain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  /**
   * Fails every tool call the engine hasn't answered (user interrupt, or a
   * conversation that moved on without the results). Unblocks the runtime's
   * MCP handlers so the session can process the interrupt / next message.
   */
  public failPendingToolCalls(reason: string): void {
    for (const pending of this.pendingTools.values()) {
      pending.resolve({ content: reason, isError: true });
    }
    this.pendingTools.clear();
    this.parkedToolCalls.length = 0;
  }

  /** Empties the parked queue: every invocation not yet handed to the engine. */
  public drainParkedToolCalls(): PendingToolCall[] {
    return this.parkedToolCalls.splice(0);
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
    if (parked) return { kind: TurnEventKind.Tool, pending: parked };

    this.inflightNext ??= this.query.next();
    const toolArrival = new Promise<void>((resolve) => {
      this.toolWake = resolve;
    });
    const streamArrival = this.inflightNext.then(
      (result): TurnEvent => ({
        kind: TurnEventKind.Message,
        message: result.done ? undefined : result.value,
      })
    );

    const event = await Promise.race([toolArrival, streamArrival]);
    this.toolWake = null;
    const arrived = this.parkedToolCalls.shift();
    if (arrived) return { kind: TurnEventKind.Tool, pending: arrived };
    if (event && event.kind === TurnEventKind.Message) {
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
  /**
   * Custom `claude` executable to spawn instead of the SDK's default
   * resolution — for users with multiple installs (personal vs work logins).
   */
  executablePath?: string | undefined;
  /**
   * `CLAUDE_CONFIG_DIR` for the spawned runtime — selects which Claude Code
   * config/login directory (and therefore which account/subscription) to use.
   * This is what shell aliases like `claude-w` set (e.g.
   * `CLAUDE_CONFIG_DIR=~/.claude-work claude`). A leading `~` is expanded to the
   * home directory. Omitted/blank means the runtime's default (`~/.claude`).
   */
  configDir?: string | undefined;
}

/**
 * The Agent SDK is ESM-only and resolves its bundled CLI from
 * `import.meta.url` at module-evaluation time, which breaks in CJS bundles
 * (e.g. the VS Code extension host, where it evaluates to undefined and
 * crashes extension activation). Loading it lazily via dynamic import keeps
 * the catalog importable everywhere; environments that can't load the SDK
 * only fail if the user actually connects the Claude Code provider.
 */
let sdkModulePromise: Promise<{ query: typeof query }> | undefined;

/** Host-supplied SDK loader, taking precedence over the bare-specifier import. */
let sdkLoader: (() => Promise<{ query: typeof query }>) | undefined;

/**
 * Lets a host that cannot resolve the bare `@anthropic-ai/claude-agent-sdk`
 * specifier (the VS Code extension, whose CJS bundle ships without
 * node_modules) supply its own loader — e.g. a native dynamic import of a
 * vendored copy of the SDK's ESM entry point.
 */
export function setAgentSdkLoader(
  loader: () => Promise<{ query: typeof query }>
): void {
  sdkLoader = loader;
  sdkModulePromise = undefined;
}

/**
 * Expands a leading `~` (as used in shell aliases like `~/.claude-work`) to the
 * home directory, since the spawned subprocess won't do tilde expansion itself.
 * Other paths pass through unchanged.
 */
function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

/** How many times {@link ClaudeAgentProvider.listModels} retries the probe. */
const PROBE_ATTEMPTS = 3;
/** Delay between probe attempts. */
const PROBE_RETRY_DELAY_MS = 500;
/** Per-attempt timeout so a hung runtime can't stall model listing. */
const PROBE_TIMEOUT_MS = 20_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Rejects with {@link message} if {@link promise} doesn't settle within {@link ms}. */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function loadQuery(): Promise<typeof query> {
  sdkModulePromise ??= sdkLoader
    ? sdkLoader()
    : import('@anthropic-ai/claude-agent-sdk');
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
  // The Claude Code runtime's in-flight turn doesn't pick up MCP tool-list
  // changes, so the engine must advertise the full toolset from turn one.
  public readonly requiresStableToolset = true;
  private readonly sessions = new Map<string, SessionBridge>();
  private readonly injectedCreateQuery: typeof query | undefined;
  private readonly executablePath: string | undefined;
  private readonly configDir: string | undefined;

  public constructor(options: ClaudeAgentProviderOptions = {}) {
    this.injectedCreateQuery = options.createQuery;
    this.executablePath = options.executablePath;
    this.configDir = options.configDir
      ? expandHome(options.configDir)
      : undefined;
  }

  /**
   * SDK options selecting the executable and config dir. Merged into every query
   * this provider spawns (sessions, model/usage probes, ephemeral). `env`
   * REPLACES the subprocess environment, so `process.env` is spread in and only
   * `CLAUDE_CONFIG_DIR` is overridden; when no config dir is set, `env` is
   * omitted entirely so the subprocess inherits the environment normally.
   */
  private executableOptions(): Pick<
    Options,
    'pathToClaudeCodeExecutable' | 'env'
  > {
    return {
      ...(this.executablePath
        ? { pathToClaudeCodeExecutable: this.executablePath }
        : {}),
      ...(this.configDir
        ? { env: { ...process.env, CLAUDE_CONFIG_DIR: this.configDir } }
        : {}),
    };
  }

  /** The injected test double, or the lazily-imported real SDK entry point. */
  private async resolveCreateQuery(): Promise<typeof query> {
    return this.injectedCreateQuery ?? loadQuery();
  }

  public async sendChat(request: ChatRequest): Promise<ChatResult> {
    // Out-of-band utility calls (title generation) never touch the persistent
    // session: their system prompt would otherwise become the session's.
    if (request.ephemeral) {
      return this.logged(request, AgentSendMode.Ephemeral, () =>
        this.runEphemeral(request)
      );
    }
    return this.logged(request, AgentSendMode.Session, () =>
      this.sessionSendChat(request)
    );
  }

  /**
   * Writes each round to the debug log like the HTTP providers do, so a dev
   * run (`JUSTCODE_DEBUG=1` / extension Development mode) captures Claude Code
   * traffic too. There is no real URL — the "request" is what justcode handed
   * the bridge; the "response" is the round's result or error. A no-op in
   * production: `logRequestResponse` only writes when the host enabled it.
   */
  private async logged(
    request: ChatRequest,
    mode: AgentSendMode,
    run: () => Promise<ChatResult>
  ): Promise<ChatResult> {
    const url = `claude-code://${mode}/${request.sessionId ?? 'default'}`;
    const body = {
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      tools: (request.tools ?? []).map((tool) => tool.name),
      messages: request.messages,
    };
    try {
      const result = await run();
      await logRequestResponse({
        request: { url, method: 'sendChat', body },
        response: { url, status: 200, ok: true, body: result },
      });
      return result;
    } catch (error) {
      await logRequestResponse({
        request: { url, method: 'sendChat', body },
        response: { url, status: 0, ok: false, body: error },
      });
      throw error;
    }
  }

  private async sessionSendChat(request: ChatRequest): Promise<ChatResult> {
    const sessionKey = request.sessionId ?? 'default';
    let bridge = this.sessions.get(sessionKey);
    // A request that no longer contains the last message we forwarded is a
    // different conversation under the same id (history edited, compacted, or
    // reset). The live session's context is stale — rebuild from scratch; the
    // replay in forwardNewMessages carries the new history across.
    if (bridge && bridge.lastSeenMessageId) {
      const anchored = request.messages.some(
        (message) => message.id === bridge?.lastSeenMessageId
      );
      if (!anchored) {
        this.dropBridge(bridge);
        bridge = undefined;
      }
    }
    // An interrupted turn can leave tool calls the engine will never answer
    // (it aborted while the model was waiting on them). If this request opens
    // a new human turn without resolving them, the live session is wedged
    // mid-turn — rebuild it; the replay carries the history across.
    if (bridge && bridge.pendingTools.size > 0) {
      const answered = new Set(
        request.messages
          .filter((message) => message.role === MessageRole.Tool)
          .map((message) => message.toolCallId)
      );
      const orphaned = [...bridge.pendingTools.keys()].some(
        (id) => !answered.has(id)
      );
      if (orphaned) {
        bridge.failPendingToolCalls('Interrupted by user.');
        this.dropBridge(bridge);
        bridge = undefined;
      }
    }
    if (!bridge) {
      bridge = this.startSession(request, await this.resolveCreateQuery());
      this.sessions.set(sessionKey, bridge);
    } else {
      await this.syncSessionOptions(bridge, request);
    }

    const activeBridge = bridge;
    // Serialize with any still-draining previous turn (see runExclusive).
    return activeBridge.runExclusive(async () => {
      this.forwardNewMessages(activeBridge, request);

      const abort = (): void => {
        // Fail unanswered tool calls first — the runtime may be blocked on
        // them — then interrupt the turn; the session stays alive to resume.
        activeBridge.failPendingToolCalls('Interrupted by user.');
        void activeBridge.query.interrupt().catch(() => {});
      };
      request.signal?.addEventListener('abort', abort, { once: true });
      try {
        return await this.collectTurn(activeBridge, request);
      } finally {
        request.signal?.removeEventListener('abort', abort);
      }
    });
  }

  public async listModels(): Promise<ModelInfo[]> {
    // Spawning the runtime to read its model list is occasionally flaky in some
    // hosts (notably the VS Code extension's Electron process, where a probe can
    // fail even though the same call succeeds moments later), so retry a couple
    // of times. But if it still fails, let the error surface — the picker then
    // shows the real reason (e.g. Claude Code isn't installed or isn't signed
    // in) instead of a misleading model list that makes it look connected.
    let lastError: unknown;
    for (let attempt = 0; attempt < PROBE_ATTEMPTS; attempt++) {
      try {
        return await this.probeSupportedModels();
      } catch (error) {
        lastError = error;
        if (attempt < PROBE_ATTEMPTS - 1) await delay(PROBE_RETRY_DELAY_MS);
      }
    }
    throw lastError;
  }

  /**
   * One `supportedModels` probe: opens a throwaway streaming-input query (which
   * never sends a prompt), reads the model list, and closes it — bounded by a
   * timeout so a hung runtime can't stall the caller indefinitely.
   */
  private async probeSupportedModels(): Promise<ModelInfo[]> {
    const input = new UserMessageStream();
    const createQuery = await this.resolveCreateQuery();
    const probe = createQuery({
      prompt: input,
      options: { tools: [], settingSources: [], ...this.executableOptions() },
    });
    try {
      const models = await withTimeout(
        probe.supportedModels(),
        PROBE_TIMEOUT_MS,
        'Timed out reading Claude Code models.'
      );
      return models.map((model) => ({
        id: model.value,
        displayName: model.displayName,
        providerId: this.providerId,
        ...(model.supportsEffort && model.supportedEffortLevels?.length
          ? {
              reasoning: {
                effortLevels: normalizeEffortLevels([
                  ...model.supportedEffortLevels,
                ]),
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

  /**
   * Runs a request in a throwaway session that is never registered in the
   * session map: fresh query, no tools, closed as soon as the result arrives.
   */
  private async runEphemeral(request: ChatRequest): Promise<ChatResult> {
    const createQuery = await this.resolveCreateQuery();
    const bridge = new SessionBridge(request.model);
    const systemMessage = request.messages.find(
      (m) => m.role === MessageRole.System
    );
    bridge.query = createQuery({
      prompt: bridge.input,
      options: {
        model: request.model,
        tools: [],
        settingSources: [],
        strictMcpConfig: true,
        ...this.executableOptions(),
        includePartialMessages: true,
        ...(systemMessage ? { systemPrompt: systemMessage.content } : {}),
        ...effortOptions(request.reasoningEffort),
      },
    });
    try {
      for (const message of request.messages) {
        if (message.role !== MessageRole.User) continue;
        bridge.input.push(chatMessageToSdkUserMessage(message));
      }
      return await this.collectTurn(bridge, request);
    } finally {
      bridge.input.close();
      await bridge.query.return(undefined).catch(() => {});
    }
  }

  /**
   * Plan usage for `/usage`: session cost plus the claude.ai rate-limit
   * windows. Uses the chat's live session when one exists (so session cost is
   * real); otherwise opens a short-lived probe query just for the lookup.
   */
  public async getUsageSummary(
    sessionId?: string
  ): Promise<ProviderUsageSummary> {
    const bridge = sessionId ? this.sessions.get(sessionId) : undefined;
    const existing = bridge ?? this.sessions.values().next().value ?? undefined;
    if (existing) {
      return toUsageSummary(await queryUsage(existing.query));
    }

    const input = new UserMessageStream();
    const createQuery = await this.resolveCreateQuery();
    const probe = createQuery({
      prompt: input,
      options: { tools: [], settingSources: [], ...this.executableOptions() },
    });
    try {
      return toUsageSummary(await queryUsage(probe));
    } finally {
      input.close();
      await probe.return(undefined).catch(() => {});
    }
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

    const systemMessage = request.messages.find(
      (m) => m.role === MessageRole.System
    );
    const options: Options = {
      model: request.model,
      // justcode owns the agent loop: no Claude Code built-ins, no user
      // settings/hooks/CLAUDE.md — the engine already provides all context.
      tools: [],
      settingSources: [],
      ...this.executableOptions(),
      mcpServers: {
        [MCP_SERVER_NAME]: this.createMcpServerConfig(bridge),
      },
      // Without this, the runtime also mounts the user's other MCP servers —
      // including claude.ai account connectors (Gmail, Drive, …) — which
      // justcode never asked for and whose calls would bypass its approval UI.
      strictMcpConfig: true,
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
        // Advertise every tool in the prompt up front. Without this the
        // runtime defers MCP tools behind its tool-search discovery, and the
        // model reports it has no tools. justcode already has its own lazy
        // tool loading, so double-deferral only hides the toolset.
        _meta: { 'anthropic/alwaysLoad': true },
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
    const conversation = request.messages.filter(
      (m) => m.role !== MessageRole.System
    );
    const lastSeenIndex = bridge.lastSeenMessageId
      ? conversation.findIndex((m) => m.id === bridge.lastSeenMessageId)
      : -1;
    let fresh = conversation.slice(lastSeenIndex + 1);

    // When starting a fresh session over an existing conversation (resumed after
    // a restart/provider switch, or rebuilt after compaction or a history edit),
    // the session missed everything up to the final user message. We replay it
    // as context — but folded INTO that user message rather than sent as its own
    // `shouldQuery: false` message: the current Agent SDK returns an *empty* turn
    // when a non-querying message precedes the querying one, so the whole reply
    // would come back blank ("provider returned an empty response").
    let contextPreamble = '';
    if (lastSeenIndex === -1 && fresh.length > 1) {
      const lastUserIndex = findLastUserIndex(fresh);
      const preamble = fresh.slice(0, lastUserIndex);
      if (preamble.length > 0) {
        contextPreamble = `Conversation so far (for context):\n\n${renderTranscript(preamble)}\n\n`;
        fresh = fresh.slice(lastUserIndex);
      }
    }

    let advancedSession = false;
    for (const message of fresh) {
      if (message.role === MessageRole.Tool) {
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
      if (message.role !== MessageRole.User) continue;
      const sdkMessage = chatMessageToSdkUserMessage(message);
      // Prepend the replayed context to the first user message we forward so it
      // rides along as a single querying turn.
      if (contextPreamble) {
        prependContext(sdkMessage, contextPreamble);
        contextPreamble = '';
      }
      bridge.input.push(sdkMessage);
      advancedSession = true;
    }

    // Nothing above moved the session forward (e.g. a restored conversation
    // whose tail is an orphaned tool result with no matching parked handler),
    // or a replay whose fresh slice held no querying user message. Push a
    // synthetic user turn — carrying any unconsumed context — so `collectTurn`
    // doesn't wait forever.
    if (!advancedSession && (fresh.length > 0 || contextPreamble)) {
      bridge.input.push(
        userMessage(
          `${contextPreamble}The conversation resumed with these messages:\n\n${renderTranscript(fresh)}\n\nContinue.`
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
      // Deliberately no early exit on abort here: the loop must keep draining
      // until the turn's result message arrives (the interrupt produces one),
      // or a stale result would sit on the shared stream and be misread as
      // the *next* turn's answer. The abort check on the result path below is
      // what turns the drained result into an AbortError.
      const event = await bridge.nextEvent();

      if (event.kind === TurnEventKind.Tool) {
        const pendings = [event.pending];
        // Parallel tool use: Claude dispatches sibling tool_use blocks
        // concurrently, so their MCP invocations park moments apart. For
        // `task` calls, wait through short quiet windows and hand the whole
        // batch to the engine in one ChatResult — that's what lets sub agents
        // actually run in parallel (a task run takes tens of seconds, so the
        // wait is noise). Regular tools return immediately: the engine
        // executes them sequentially anyway, and the wait would tax every
        // fast read/edit round trip.
        if (stripToolPrefix(event.pending.call.name) === ToolName.Task) {
          let waitedMs = 0;
          while (waitedMs < TASK_BATCH_MAX_WAIT_MS) {
            await delay(TASK_BATCH_QUIET_MS);
            waitedMs += TASK_BATCH_QUIET_MS;
            const drained = bridge.drainParkedToolCalls();
            if (drained.length === 0) break;
            pendings.push(...drained);
          }
        }
        return {
          content,
          toolCalls: pendings.map((pending) => ({
            ...pending.call,
            name: stripToolPrefix(pending.call.name),
          })),
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

  /**
   * Tears down the live session for `sessionId`, if any. Used by sub agent
   * runs, which mint a throwaway session id per run so they get real tool
   * calling — without this each finished run would leak a runtime process.
   */
  public closeSession(sessionId: string): void {
    const bridge = this.sessions.get(sessionId);
    if (!bridge) return;
    this.dropBridge(bridge);
    void bridge.query.return(undefined).catch(() => {});
  }

  private dropBridge(bridge: SessionBridge): void {
    for (const [key, value] of this.sessions) {
      if (value === bridge) this.sessions.delete(key);
    }
    bridge.input.close();
  }
}

/** The SDK's structured /usage payload (experimental control request). */
interface SdkUsageResponse {
  session?: { total_cost_usd?: number };
  subscription_type?: string | null;
  rate_limits?: Record<
    string,
    { utilization?: number | null; resets_at?: string | null } | null
  > | null;
}

/**
 * Calls the SDK's /usage control request. The method name carries an
 * experimental warning label; isolate it here so the rest of the provider
 * only deals in the normalized {@link ProviderUsageSummary}.
 */
async function queryUsage(target: Query): Promise<SdkUsageResponse> {
  const experimental = target as unknown as {
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(): Promise<SdkUsageResponse>;
  };
  return experimental.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET();
}

/** Human labels for the rate-limit windows /usage reports. */
const USAGE_WINDOW_LABELS: Record<string, string> = {
  five_hour: '5-hour',
  seven_day: '7-day',
  seven_day_oauth_apps: '7-day (apps)',
  seven_day_opus: '7-day (Opus)',
  seven_day_sonnet: '7-day (Sonnet)',
};

function toUsageSummary(usage: SdkUsageResponse): ProviderUsageSummary {
  const windows: ProviderUsageWindow[] = [];
  for (const [key, window] of Object.entries(usage.rate_limits ?? {})) {
    // rate_limits mixes utilization windows with config blobs (extra_usage,
    // limits, spend, …) — only entries with actual window data are shown.
    if (!window || (window.utilization == null && !window.resets_at)) continue;
    windows.push({
      label: USAGE_WINDOW_LABELS[key] ?? key,
      ...(window.utilization != null
        ? { utilization: window.utilization }
        : {}),
      ...(window.resets_at ? { resetsAt: window.resets_at } : {}),
    });
  }
  return {
    ...(usage.subscription_type ? { plan: usage.subscription_type } : {}),
    windows,
    ...(usage.session?.total_cost_usd != null
      ? { sessionCostUsd: usage.session.total_cost_usd }
      : {}),
  };
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
    if (messages[index]?.role === MessageRole.User) return index;
  }
  return messages.length - 1;
}

/** Renders prior turns as plain text for the resumed-session context block. */
function renderTranscript(messages: ChatMessage[]): string {
  return messages
    .map((message) => {
      if (message.role === MessageRole.Tool) {
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

/**
 * Prepends replayed-history context as a leading text block on a user message,
 * so it travels as part of that querying turn. Used by the resume/rebuild replay
 * instead of a separate `shouldQuery: false` message, which the current Agent
 * SDK answers with an empty turn.
 */
function prependContext(message: SDKUserMessage, context: string): void {
  const content = message.message.content;
  if (Array.isArray(content)) {
    content.unshift({ type: 'text', text: context } as never);
  } else {
    message.message.content = `${context}${content}` as never;
  }
}

/**
 * The Claude Code runtime intercepts user messages that start with `/` as its
 * own slash commands and answers "Unknown command" without ever running the
 * turn. justcode's skill commands (e.g. `/firecrawl <url>`) are resolved by
 * justcode itself and must reach the model as literal text — a leading space
 * defeats the runtime's command parsing without changing what the model reads.
 */
function escapeSlashCommand(text: string): string {
  return text.startsWith('/') ? ` ${text}` : text;
}

function chatMessageToSdkUserMessage(message: ChatMessage): SDKUserMessage {
  const blocks: Array<Record<string, unknown>> = [];
  const text = escapeSlashCommand(renderMessageContentForModel(message));
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
  if (blocks.length === 0) {
    blocks.push({ type: 'text', text: escapeSlashCommand(message.content) });
  }
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
  if (effort === ReasoningDisabled.Off)
    return { thinking: { type: 'disabled' } };
  return { effort };
}
