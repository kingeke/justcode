import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  type ChatRequest,
  type ChatResult,
  type ModelInfo,
  type ProviderClient,
  type TokenUsage,
} from '@core/ports/chat-model';
import { ProviderId } from '@core/ports/provider-catalog';
import {
  MessageRole,
  renderMessageContentForModel,
  type ChatMessage,
  type ToolCall,
} from '@core/domain/message';
import type { ToolResult } from '@core/ports/tool';
import { ToolName } from '@core/domain/tool-name';
import { logRequestResponse } from '@core/application/debug-log';
import {
  CursorMcpBridge,
  createCursorWorkspace,
  type CursorSessionWorkspace,
} from '@providers/cursor/mcp-bridge';
import { detectCursorExecutable } from '@providers/cursor/detect-cursor';

/**
 * Cursor subscription provider backed by the official Cursor CLI
 * (`cursor-agent`). justcode never touches credentials: the spawned CLI reads
 * the user's own `cursor-agent login` session (or `CURSOR_API_KEY`), and usage
 * bills to the user's Cursor plan — the same sanctioned posture as the Claude
 * Code provider.
 *
 * Bridging model (mirrors `claude-agent-provider.ts`): justcode's agent loop
 * owns tool execution. Each turn spawns one print-mode CLI process
 * (`-p --output-format stream-json --stream-partial-output`), continued
 * across turns with `--resume <session_id>`. The process runs inside an ephemeral
 * project directory whose `.cursor/cli.json` denies Cursor's built-in
 * shell/read/write/web tools and whose `.cursor/mcp.json` points at a loopback
 * MCP server advertising justcode's tools. When the model calls one, the MCP
 * handler *parks* the invocation: `sendChat` returns it as
 * `ChatResult.toolCalls`, the child process stays alive blocked on the MCP
 * response, and the next `sendChat` resolves the parked promise with the
 * engine's result — the turn then continues in the same process.
 *
 * Known, deliberate limitation: Cursor's permission tokens cannot deny the
 * read-only search built-ins (grep/glob/ls), which see only the ephemeral
 * directory. Fallback if print mode ever regresses: the CLI's ACP mode
 * (`cursor-agent acp`) offers explicit permission and session RPCs.
 */

/**
 * Batch window for parallel `task` calls (see collectTurn): after the first
 * task invocation parks, keep collecting siblings while they arrive within
 * each quiet step, up to the cap — that is what lets sub agents run in
 * parallel.
 */
const TASK_BATCH_QUIET_MS = 150;
const TASK_BATCH_MAX_WAIT_MS = 1500;

/** Per-run timeout for the `models` listing so a hung CLI can't stall it. */
const MODELS_TIMEOUT_MS = 30_000;

/** NDJSON event types emitted by `-p --output-format stream-json`. */
enum CursorEventType {
  System = 'system',
  User = 'user',
  Assistant = 'assistant',
  Thinking = 'thinking',
  ToolCall = 'tool_call',
  Result = 'result',
}

enum CursorEventSubtype {
  Init = 'init',
  Delta = 'delta',
  Success = 'success',
}

/** One parsed NDJSON event from the Cursor CLI's stream-json output. */
interface CursorEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  /** Present on cumulative per-segment assistant repeats — not on deltas. */
  model_call_id?: string;
  /** Present on streamed deltas; absent on the final cumulative repeat. */
  timestamp_ms?: number;
  message?: {
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
  /** Thinking delta text. */
  text?: string;
  /** Final turn text on `result` events. */
  result?: string;
  is_error?: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

/** What a spawned CLI run is asked to execute. */
export interface CursorRunOptions {
  executablePath: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv | undefined;
  /** Written to stdin, which is then closed (print-mode prompt input). */
  prompt: string;
}

/** A live CLI child process, minimally abstracted so tests can fake it. */
export interface CursorAgentRun {
  /** Raw stdout chunks; NDJSON line splitting happens in the provider. */
  readonly stdout: AsyncIterable<string>;
  /** Full stderr text, resolving when the process closes. */
  readonly stderr: Promise<string>;
  /** Exit code; rejects on spawn failure (e.g. executable not found). */
  readonly exited: Promise<number | null>;
  kill(): void;
}

/**
 * Factory for CLI runs — injectable so tests can drive the bridge with fake
 * NDJSON events without spawning the real Cursor CLI.
 */
export type CursorSpawn = (options: CursorRunOptions) => CursorAgentRun;

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

type TurnEvent =
  | { kind: TurnEventKind.Message; event: CursorEvent | undefined }
  | { kind: TurnEventKind.Tool; pending: PendingToolCall };

/** Spawns the real CLI and adapts the child process to {@link CursorAgentRun}. */
const defaultSpawn: CursorSpawn = (options) => {
  const child = spawn(options.executablePath, options.args, {
    cwd: options.cwd,
    ...(options.env ? { env: options.env } : {}),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.on('error', () => {});
  child.stdin.write(options.prompt);
  child.stdin.end();
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  const stderrChunks: string[] = [];
  child.stderr.on('data', (chunk: string) => stderrChunks.push(chunk));

  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code));
  });
  // A run's exit is often only inspected on failure paths; don't let the
  // unobserved rejection crash the host.
  exited.catch(() => {});

  return {
    stdout: child.stdout as AsyncIterable<string>,
    stderr: exited.then(
      () => stderrChunks.join(''),
      () => stderrChunks.join('')
    ),
    exited,
    kill: () => {
      child.kill('SIGTERM');
    },
  };
};

/** Splits raw stdout chunks into parsed NDJSON events. */
async function* parseEvents(
  stdout: AsyncIterable<string>
): AsyncGenerator<CursorEvent, void> {
  let buffer = '';
  try {
    for await (const chunk of stdout) {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line) continue;
        try {
          yield JSON.parse(line) as CursorEvent;
        } catch {
          // Non-JSON noise on stdout (warnings) — skip.
        }
      }
    }
  } catch {
    // Stream torn down (killed process) — treated as end-of-stream.
  }
}

/** A live Cursor CLI session (thread) bridged to one justcode chat session. */
class SessionBridge {
  public model: string;
  /** Cursor thread id from the init event; reused via `--resume`. */
  public cursorSessionId: string | undefined;
  /** id of the last conversation message already forwarded into the session. */
  public lastSeenMessageId: string | undefined;
  /** True once the system prompt has been folded into a forwarded prompt. */
  public sentSystemPrompt = false;
  /** Tool calls the model has made that the engine hasn't answered yet. */
  public readonly pendingTools = new Map<string, PendingToolCall>();
  /** Tool invocations parked by the MCP handler, awaiting pickup by sendChat. */
  public readonly parkedToolCalls: PendingToolCall[] = [];
  public readonly mcp: CursorMcpBridge;
  public workspace: CursorSessionWorkspace | undefined;
  /** The live child process, present while a turn is open (possibly parked). */
  public run: CursorAgentRun | undefined;
  private events: AsyncIterator<CursorEvent, void> | undefined;
  private toolWake: (() => void) | null = null;
  /** The stream `next()` in flight, kept across sendChat boundaries. */
  private inflightNext: Promise<IteratorResult<CursorEvent, void>> | null =
    null;
  /** Serializes turns — see the Claude bridge for the rationale. */
  private turnChain: Promise<void> = Promise.resolve();

  public constructor(model: string) {
    this.model = model;
    this.mcp = new CursorMcpBridge(
      (call) =>
        new Promise<ToolResult>((resolve) => {
          this.parkToolCall({ call, resolve });
        })
    );
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

  public attachRun(run: CursorAgentRun): void {
    this.run = run;
    this.events = parseEvents(run.stdout)[Symbol.asyncIterator]();
    this.inflightNext = null;
  }

  public detachRun(): void {
    this.run = undefined;
    this.events = undefined;
    this.inflightNext = null;
  }

  /**
   * Fails every tool call the engine hasn't answered (user interrupt, or a
   * conversation that moved on). Unblocks the bridge's MCP handlers so the CLI
   * turn can finish instead of hanging on a response that will never come.
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
   * model asks for it. The in-flight stream read is stashed and reused —
   * an AsyncGenerator can't have two concurrent `next()`s.
   */
  public async nextEvent(): Promise<TurnEvent> {
    const parked = this.parkedToolCalls.shift();
    if (parked) return { kind: TurnEventKind.Tool, pending: parked };
    if (!this.events) return { kind: TurnEventKind.Message, event: undefined };

    this.inflightNext ??= this.events.next();
    const toolArrival = new Promise<void>((resolve) => {
      this.toolWake = resolve;
    });
    const streamArrival = this.inflightNext.then(
      (result): TurnEvent => ({
        kind: TurnEventKind.Message,
        event: result.done ? undefined : result.value,
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
    return this.nextEvent();
  }
}

export interface CursorAgentProviderOptions {
  /** Injectable CLI-run factory so tests never spawn the real CLI. */
  spawnAgent?: CursorSpawn;
  /**
   * Custom `cursor-agent` executable to spawn — for users whose install isn't
   * on PATH or who keep multiple installs.
   */
  executablePath?: string | undefined;
  /**
   * `CURSOR_CONFIG_DIR` for the spawned CLI — selects which Cursor config
   * directory to use, for users running multiple accounts. Left unset (the
   * default and recommended value), the CLI resolves the user's normal login.
   */
  configDir?: string | undefined;
}

/** Expands a leading `~` since the spawned subprocess won't do it itself. */
function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

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

/**
 * Folded into every thread's first prompt. Cursor's own harness prompt steers
 * the model toward its built-in file/shell tools; with those denied, the model
 * otherwise concludes the workspace is read-only and never tries the justcode
 * MCP tools for writes (verified live: reads fall back, edits give up).
 */
const TOOL_ENVIRONMENT_NOTE =
  "Environment note: this session's built-in file, shell, and web tools are " +
  'disabled by policy and return permission errors. The tools from the ' +
  "'justcode' MCP server are the ONLY way to read, search, create, or edit " +
  'files and run commands — and they are fully permitted, including writes ' +
  'and shell commands. Never conclude the workspace is read-only; use the ' +
  'justcode tools instead of the built-ins.';

const INSTALL_HINT =
  'Check that the Cursor CLI is installed (`curl https://cursor.com/install -fsS | bash`) ' +
  'and signed in (`cursor-agent login`).';

export class CursorAgentProvider implements ProviderClient {
  public readonly providerId = ProviderId.Cursor;
  // Each turn's CLI process lists MCP tools once at startup, so the engine
  // must advertise the full toolset from turn one.
  public readonly requiresStableToolset = true;
  private readonly sessions = new Map<string, SessionBridge>();
  private readonly spawnAgent: CursorSpawn;
  private readonly executablePath: string | undefined;
  private readonly configDir: string | undefined;
  private resolvedExecutable: Promise<string> | undefined;
  private ephemeralWorkspace: Promise<CursorSessionWorkspace> | undefined;

  public constructor(options: CursorAgentProviderOptions = {}) {
    this.spawnAgent = options.spawnAgent ?? defaultSpawn;
    this.executablePath = options.executablePath;
    this.configDir = options.configDir
      ? expandHome(options.configDir)
      : undefined;
  }

  public async sendChat(request: ChatRequest): Promise<ChatResult> {
    // Out-of-band utility calls (title generation) never touch the persistent
    // session — they run as tool-less one-shot CLI invocations.
    if (request.ephemeral) {
      return this.logged(request, 'ephemeral', () =>
        this.runEphemeral(request)
      );
    }
    return this.logged(request, 'session', () => this.sessionSendChat(request));
  }

  public async listModels(): Promise<ModelInfo[]> {
    const run = this.spawnAgent({
      executablePath: await this.resolveExecutable(),
      args: ['models'],
      cwd: process.cwd(),
      env: this.spawnEnv(),
      prompt: '',
    });
    const output = await withTimeout(
      collectRunOutput(run),
      MODELS_TIMEOUT_MS,
      'Timed out listing Cursor models.'
    ).finally(() => run.kill());
    if (output.exitCode !== 0 || /not logged in/i.test(output.combined)) {
      throw new Error(
        `Could not list Cursor models${
          output.combined.trim() ? ` (${output.combined.trim()})` : ''
        }. ${INSTALL_HINT}`
      );
    }
    const models: ModelInfo[] = [];
    for (const line of output.stdout.split('\n')) {
      const match = /^(\S+)\s+-\s+(.+)$/.exec(line.trim());
      if (!match?.[1] || !match[2]) continue;
      models.push({
        id: match[1],
        displayName: match[2].replace(/\s*\((current|default)[^)]*\)\s*$/, ''),
        providerId: this.providerId,
      });
    }
    if (models.length === 0) {
      throw new Error(`Cursor CLI returned no models. ${INSTALL_HINT}`);
    }
    return models;
  }

  public getDefaultModel(): string | undefined {
    return 'auto';
  }

  /** Tears down the live session for `sessionId`, if any. */
  public closeSession(sessionId: string): void {
    const bridge = this.sessions.get(sessionId);
    if (bridge) this.destroyBridge(bridge, 'Session closed.');
  }

  /** Tears down every live Cursor session this provider started. */
  public async dispose(): Promise<void> {
    for (const bridge of [...this.sessions.values()]) {
      this.destroyBridge(bridge, 'Provider disposed.');
    }
    if (this.ephemeralWorkspace) {
      const workspace = await this.ephemeralWorkspace.catch(() => undefined);
      await workspace?.cleanup();
      this.ephemeralWorkspace = undefined;
    }
  }

  /** The configured executable, the detected install, or the bare name. */
  private resolveExecutable(): Promise<string> {
    this.resolvedExecutable ??= (async () =>
      this.executablePath ??
      (await detectCursorExecutable()) ??
      'cursor-agent')();
    return this.resolvedExecutable;
  }

  /**
   * Environment for spawned runs. Only set when a config dir override was
   * configured — otherwise the child inherits the environment untouched and
   * the CLI resolves the user's default login.
   */
  private spawnEnv(): NodeJS.ProcessEnv | undefined {
    return this.configDir
      ? { ...process.env, CURSOR_CONFIG_DIR: this.configDir }
      : undefined;
  }

  /**
   * Writes each round to the debug log like the HTTP providers do. There is no
   * real URL — the "request" is what justcode handed the bridge; the
   * "response" is the round's result or error. A no-op in production.
   */
  private async logged(
    request: ChatRequest,
    mode: 'session' | 'ephemeral',
    run: () => Promise<ChatResult>
  ): Promise<ChatResult> {
    const url = `cursor://${mode}/${request.sessionId ?? 'default'}`;
    const body = {
      model: request.model,
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
    // reset). The thread's context is stale — rebuild from scratch; the replay
    // in buildTurnPrompt carries the new history across. (Toolset changes need
    // no rebuild: every spawned process re-lists the bridge's tools fresh.)
    if (bridge && bridge.lastSeenMessageId) {
      const anchored = request.messages.some(
        (message) => message.id === bridge?.lastSeenMessageId
      );
      if (!anchored) {
        this.destroyBridge(bridge, 'Conversation rebuilt.');
        bridge = undefined;
      }
    }
    // An interrupted turn can leave tool calls the engine will never answer.
    // If this request opens a new human turn without resolving them, the live
    // turn is wedged — rebuild; the replay carries the history across.
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
        this.destroyBridge(bridge, 'Interrupted by user.');
        bridge = undefined;
      }
    }
    if (!bridge) {
      bridge = new SessionBridge(request.model);
      this.sessions.set(sessionKey, bridge);
    }
    const activeBridge = bridge;
    activeBridge.model = request.model;
    activeBridge.mcp.toolDefinitions = request.tools ?? [];

    // Serialize with any still-draining previous turn (see runExclusive).
    return activeBridge.runExclusive(async () => {
      const prompt = this.buildTurnPrompt(activeBridge, request);
      if (prompt) {
        // A fresh prompt supersedes any still-open turn (its parked calls were
        // already resolved or failed above / by buildTurnPrompt).
        if (activeBridge.run) {
          activeBridge.failPendingToolCalls('Superseded by a new message.');
          activeBridge.run.kill();
          activeBridge.detachRun();
        }
        await this.startTurn(activeBridge, prompt);
      }

      const abort = (): void => {
        // Fail unanswered tool calls first — the CLI may be blocked on them —
        // then kill the process. The next turn replays history in a new thread.
        activeBridge.failPendingToolCalls('Interrupted by user.');
        activeBridge.run?.kill();
      };
      request.signal?.addEventListener('abort', abort, { once: true });
      try {
        return await this.collectTurn(activeBridge, request);
      } finally {
        request.signal?.removeEventListener('abort', abort);
      }
    });
  }

  /**
   * Settles the messages this request added since the last call against the
   * live session — tool results resolve parked MCP handlers (the running
   * process continues by itself) — and renders whatever needs a new CLI run
   * (user messages, replayed history) as the next prompt. Returns '' when the
   * request only continued an open turn.
   */
  /**
   * Settles the messages this request added since the last call against the
   * live session — tool results resolve parked MCP handlers (the running
   * process continues by itself) — and renders whatever needs a new CLI run
   * (user messages, replayed history) as the next prompt. Returns '' when the
   * request only continued an open turn.
   */
  private buildTurnPrompt(bridge: SessionBridge, request: ChatRequest): string {
    const conversation = request.messages.filter(
      (m) => m.role !== MessageRole.System
    );
    const lastSeenIndex = bridge.lastSeenMessageId
      ? conversation.findIndex((m) => m.id === bridge.lastSeenMessageId)
      : -1;
    let fresh = conversation.slice(lastSeenIndex + 1);

    // Starting a fresh session over an existing conversation (resumed after a
    // restart, or rebuilt after compaction / a history edit): everything up to
    // the final user message is replayed as a context block.
    let contextPreamble = '';
    if (lastSeenIndex === -1 && fresh.length > 1) {
      const lastUserIndex = findLastUserIndex(fresh);
      const preamble = fresh.slice(0, lastUserIndex);
      if (preamble.length > 0) {
        contextPreamble = `Conversation so far (for context):\n\n${renderTranscript(preamble)}\n\n`;
        fresh = fresh.slice(lastUserIndex);
      }
    }

    const promptParts: string[] = [];
    let resolvedToolCall = false;
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
          resolvedToolCall = true;
        }
        continue;
      }
      if (message.role !== MessageRole.User) continue;
      promptParts.push(
        escapeSlashCommand(renderMessageContentForModel(message))
      );
    }

    let prompt = promptParts.join('\n\n');
    if (contextPreamble) prompt = `${contextPreamble}${prompt || 'Continue.'}`;
    // Nothing above moved the session forward (e.g. a restored conversation
    // whose tail is an orphaned tool result with no matching parked handler).
    // Render a synthetic turn so the CLI has something to run.
    if (!prompt && !resolvedToolCall && fresh.length > 0) {
      prompt = `The conversation resumed with these messages:\n\n${renderTranscript(fresh)}\n\nContinue.`;
    }
    // A retry with no new messages and no open turn: nudge the model.
    if (!prompt && !bridge.run) prompt = 'Continue.';

    // The CLI has no system-prompt flag; the system prompt is folded into the
    // thread's first prompt. The tool environment note rides on EVERY spawned
    // turn: Cursor's own harness prompt steers the model back toward its
    // (denied) built-ins, and a first-turn-only note loses out on later turns.
    if (prompt) {
      const preamble: string[] = [];
      if ((request.tools?.length ?? 0) > 0) {
        preamble.push(TOOL_ENVIRONMENT_NOTE);
      }
      if (!bridge.sentSystemPrompt) {
        const system = request.messages.find(
          (m) => m.role === MessageRole.System
        );
        if (system) preamble.push(`System instructions:\n\n${system.content}`);
      }
      if (preamble.length > 0) {
        prompt = `${preamble.join('\n\n')}\n\n---\n\n${prompt}`;
      }
    }

    const lastMessage = conversation[conversation.length - 1];
    if (lastMessage) bridge.lastSeenMessageId = lastMessage.id;
    return prompt;
  }

  /** Spawns the next CLI run for this session, resuming its thread if any. */
  private async startTurn(
    bridge: SessionBridge,
    prompt: string
  ): Promise<void> {
    await bridge.mcp.start();
    bridge.workspace ??= await createCursorWorkspace({
      mcpPort: bridge.mcp.port,
    });
    const args = [
      '-p',
      '--force',
      '--approve-mcps',
      '--output-format',
      'stream-json',
      '--stream-partial-output',
      '--model',
      bridge.model,
    ];
    if (bridge.cursorSessionId) args.push('--resume', bridge.cursorSessionId);
    const run = this.spawnAgent({
      executablePath: await this.resolveExecutable(),
      args,
      cwd: bridge.workspace.directory,
      env: this.spawnEnv(),
      prompt,
    });
    bridge.attachRun(run);
    bridge.sentSystemPrompt = true;
  }

  /**
   * Runs a request as a tool-less one-shot CLI invocation in a shared
   * ephemeral directory whose `cli.json` denies every built-in and MCP tool.
   */
  private async runEphemeral(request: ChatRequest): Promise<ChatResult> {
    this.ephemeralWorkspace ??= createCursorWorkspace({ denyAllMcp: true });
    const workspace = await this.ephemeralWorkspace;
    const system = request.messages.find((m) => m.role === MessageRole.System);
    const parts = request.messages
      .filter((m) => m.role === MessageRole.User)
      .map((m) => escapeSlashCommand(renderMessageContentForModel(m)));
    const prompt = `${
      system ? `System instructions:\n\n${system.content}\n\n---\n\n` : ''
    }${parts.join('\n\n')}`;

    const bridge = new SessionBridge(request.model);
    const run = this.spawnAgent({
      executablePath: await this.resolveExecutable(),
      args: [
        '-p',
        '--force',
        '--output-format',
        'stream-json',
        '--model',
        request.model,
      ],
      cwd: workspace.directory,
      env: this.spawnEnv(),
      prompt,
    });
    bridge.attachRun(run);
    try {
      return await this.collectTurn(bridge, request);
    } finally {
      run.kill();
    }
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
      const event = await bridge.nextEvent();

      if (event.kind === TurnEventKind.Tool) {
        const pendings = [event.pending];
        // Parallel `task` calls park moments apart; batch them so sub agents
        // actually run in parallel. Regular tools return immediately.
        if (event.pending.call.name === ToolName.Task) {
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
          toolCalls: pendings.map((pending) => pending.call),
        };
      }

      const message = event.event;
      if (!message) {
        // Stream ended without a result — the process was killed (abort) or
        // died (not installed / logged out / crash).
        const run = bridge.run;
        bridge.detachRun();
        if (request.signal?.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
        let spawnError = '';
        let stderrText = '';
        if (run) {
          try {
            await run.exited;
          } catch (error) {
            spawnError = error instanceof Error ? error.message : String(error);
          }
          stderrText = (await run.stderr.catch(() => '')).trim();
        }
        // The CLI reports actionable failures (e.g. plan restrictions like
        // "Named models unavailable") as plain text on stderr with no result
        // event. Surface that message as-is — the install/sign-in hint would
        // only mislead.
        if (stderrText && !spawnError) {
          throw new Error(`Provider 'cursor' failed: ${stderrText}`);
        }
        throw new Error(
          `Provider 'cursor' ended the turn unexpectedly${
            spawnError ? ` (${spawnError})` : ''
          }. ${INSTALL_HINT}`
        );
      }

      if (
        message.type === CursorEventType.System &&
        message.subtype === CursorEventSubtype.Init
      ) {
        if (message.session_id) bridge.cursorSessionId = message.session_id;
        continue;
      }

      if (message.type === CursorEventType.Assistant) {
        // Deltas carry `timestamp_ms` and no `model_call_id`; cumulative
        // repeats (per-segment and turn-final) are skipped.
        if (
          message.timestamp_ms !== undefined &&
          message.model_call_id === undefined
        ) {
          const text = (message.message?.content ?? [])
            .map((block) => block.text ?? '')
            .join('');
          if (text) {
            content += text;
            request.onToken?.(text);
          }
        }
        continue;
      }

      if (
        message.type === CursorEventType.Thinking &&
        message.subtype === CursorEventSubtype.Delta
      ) {
        if (message.text) request.onThinkingToken?.(message.text);
        continue;
      }

      if (message.type === CursorEventType.Result) {
        bridge.detachRun();
        if (message.usage) {
          usage = {
            inputTokens:
              (message.usage.inputTokens ?? 0) +
              (message.usage.cacheReadTokens ?? 0) +
              (message.usage.cacheWriteTokens ?? 0),
            outputTokens: message.usage.outputTokens ?? 0,
            cachedTokens: message.usage.cacheReadTokens ?? 0,
          };
        }
        if (request.signal?.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
        if (
          message.subtype !== CursorEventSubtype.Success ||
          message.is_error
        ) {
          const detail = message.result?.trim();
          throw new Error(
            `Provider 'cursor' failed (${message.subtype ?? 'error'}).${
              detail ? ` ${detail}` : ''
            }`
          );
        }
        const finalContent = content.trim() ? content : (message.result ?? '');
        if (!finalContent.trim()) {
          throw new Error("Provider 'cursor' returned an empty response.");
        }
        return { content: finalContent, ...(usage ? { usage } : {}) };
      }

      // Everything else (user echoes, tool_call progress) is bookkeeping; MCP
      // tool invocations arrive through the bridge, not the event stream.
    }
  }

  private destroyBridge(bridge: SessionBridge, reason: string): void {
    for (const [key, value] of this.sessions) {
      if (value === bridge) this.sessions.delete(key);
    }
    bridge.failPendingToolCalls(reason);
    bridge.run?.kill();
    bridge.detachRun();
    void bridge.mcp.close();
    void bridge.workspace?.cleanup();
    bridge.workspace = undefined;
  }
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

/**
 * The Cursor CLI intercepts prompts that start with `/` as its own slash
 * commands; justcode's skill commands must reach the model as literal text —
 * a leading space defeats the command parsing without changing what the model
 * reads.
 */
function escapeSlashCommand(text: string): string {
  return text.startsWith('/') ? ` ${text}` : text;
}

/** Collected output of a completed non-chat run (e.g. `models`). */
async function collectRunOutput(run: CursorAgentRun): Promise<{
  stdout: string;
  combined: string;
  exitCode: number | null;
}> {
  let stdout = '';
  for await (const chunk of run.stdout) stdout += chunk;
  const stderr = await run.stderr.catch(() => '');
  let exitCode: number | null = null;
  let spawnError = '';
  try {
    exitCode = await run.exited;
  } catch (error) {
    exitCode = -1;
    spawnError = error instanceof Error ? error.message : String(error);
  }
  return {
    stdout,
    combined: [stdout, stderr, spawnError].filter(Boolean).join('\n'),
    exitCode,
  };
}
