import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import {
  createMessage,
  MessageRole,
  type ChatMessage,
} from '@core/domain/message';
import {
  CursorAgentProvider,
  type CursorAgentRun,
  type CursorRunOptions,
  type CursorSpawn,
} from '@providers/cursor/cursor-agent-provider';
import { createCursorWorkspace } from '@providers/cursor/mcp-bridge';

/** A fake CLI child process the tests feed NDJSON events into. */
class FakeRun implements CursorAgentRun {
  public killed = false;
  private readonly queue: string[] = [];
  private waiter: ((result: IteratorResult<string, void>) => void) | null =
    null;
  private done = false;
  private exitResolve!: (code: number | null) => void;
  public readonly exited = new Promise<number | null>((resolve) => {
    this.exitResolve = resolve;
  });
  /** Text `stderr` resolves with once the process ends. */
  public stderrText = '';
  private stderrResolve!: (text: string) => void;
  public readonly stderr = new Promise<string>((resolve) => {
    this.stderrResolve = resolve;
  });

  public constructor(public readonly options: CursorRunOptions) {}

  /** Emits one NDJSON event line on stdout. */
  public emit(event: object): void {
    this.write(`${JSON.stringify(event)}\n`);
  }

  /** Emits raw stdout text (e.g. the `models` listing). */
  public write(chunk: string): void {
    if (this.done) return;
    const waiter = this.waiter;
    if (waiter) {
      this.waiter = null;
      waiter({ value: chunk, done: false });
      return;
    }
    this.queue.push(chunk);
  }

  public end(code: number | null = 0): void {
    if (this.done) return;
    this.done = true;
    this.exitResolve(code);
    this.stderrResolve(this.stderrText);
    const waiter = this.waiter;
    if (waiter) {
      this.waiter = null;
      waiter({ value: undefined, done: true });
    }
  }

  public kill(): void {
    this.killed = true;
    this.end(null);
  }

  public get stdout(): AsyncIterable<string> {
    const run = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<string, void> {
        return {
          next(): Promise<IteratorResult<string, void>> {
            const queued = run.queue.shift();
            if (queued !== undefined) {
              return Promise.resolve({ value: queued, done: false });
            }
            if (run.done) {
              return Promise.resolve({ value: undefined, done: true });
            }
            return new Promise((resolve) => {
              run.waiter = resolve;
            });
          },
        };
      },
    };
  }
}

/** Captures every spawn and hands the fake runs to the test in order. */
class FakeCursorHarness {
  public readonly runs: FakeRun[] = [];
  private served = 0;
  private readonly spawnWaiters: (() => void)[] = [];

  public readonly spawn: CursorSpawn = (options) => {
    const run = new FakeRun(options);
    this.runs.push(run);
    this.spawnWaiters.splice(0).forEach((wake) => wake());
    return run;
  };

  public async nextSpawn(): Promise<FakeRun> {
    while (this.runs.length <= this.served) {
      await new Promise<void>((resolve) => this.spawnWaiters.push(resolve));
    }
    return this.runs[this.served++]!;
  }
}

const THREAD = 'thread-1';

const init = (sessionId = THREAD): object => ({
  type: 'system',
  subtype: 'init',
  apiKeySource: 'login',
  session_id: sessionId,
  model: 'Auto',
});

const delta = (text: string): object => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
  session_id: THREAD,
  timestamp_ms: 1,
});

/** Per-segment cumulative repeat (has model_call_id) — must be skipped. */
const segmentRepeat = (text: string): object => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
  session_id: THREAD,
  model_call_id: 'call-x',
  timestamp_ms: 2,
});

/** Turn-final cumulative repeat (no timestamp_ms) — must be skipped. */
const finalRepeat = (text: string): object => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
  session_id: THREAD,
});

const thinkingDelta = (text: string): object => ({
  type: 'thinking',
  subtype: 'delta',
  text,
  session_id: THREAD,
  timestamp_ms: 1,
});

const resultEvent = (text: string): object => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 5,
  result: text,
  session_id: THREAD,
  usage: {
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 100,
    cacheWriteTokens: 5,
  },
});

const READ_TOOL = {
  name: 'read_file',
  description: 'Read a file',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
};

function makeProvider(harness: FakeCursorHarness): CursorAgentProvider {
  return new CursorAgentProvider({
    spawnAgent: harness.spawn,
    executablePath: '/fake/cursor-agent',
  });
}

/** Connects a real MCP client to the bridge endpoint a spawned run was given. */
async function connectMcpClient(run: FakeRun): Promise<Client> {
  const raw = await readFile(
    join(run.options.cwd, '.cursor', 'mcp.json'),
    'utf8'
  );
  const config = JSON.parse(raw) as {
    mcpServers: { justcode: { url: string } };
  };
  const client = new Client({ name: 'test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL(config.mcpServers.justcode.url)
  );
  // Cast: exactOptionalPropertyTypes flags the SDK's own transport class
  // against its Transport interface (`sessionId` optionality) — an
  // SDK-internal mismatch, not a real incompatibility.
  await client.connect(
    transport as unknown as Parameters<typeof client.connect>[0]
  );
  return client;
}

describe('CursorAgentProvider', () => {
  it('streams text deltas, skips cumulative repeats, and maps result/usage', async () => {
    const harness = new FakeCursorHarness();
    const provider = makeProvider(harness);
    try {
      const tokens: string[] = [];
      const thinking: string[] = [];
      const send = provider.sendChat({
        model: 'auto',
        sessionId: 's1',
        messages: [
          createMessage(MessageRole.System, 'You are helpful.'),
          createMessage(MessageRole.User, 'hello'),
        ],
        onToken: (token) => tokens.push(token),
        onThinkingToken: (token) => thinking.push(token),
      });

      const run = await harness.nextSpawn();
      expect(run.options.executablePath).toBe('/fake/cursor-agent');
      expect(run.options.args).toEqual([
        '-p',
        '--force',
        '--approve-mcps',
        '--output-format',
        'stream-json',
        '--stream-partial-output',
        '--model',
        'auto',
      ]);
      expect(run.options.prompt).toContain('System instructions:');
      expect(run.options.prompt).toContain('You are helpful.');
      expect(run.options.prompt).toContain('hello');

      run.emit(init());
      run.emit(thinkingDelta('pondering'));
      run.emit(delta('hel'));
      run.emit(delta('lo!'));
      run.emit(segmentRepeat('hello!'));
      run.emit(finalRepeat('hello!'));
      run.emit(resultEvent('hello!'));

      const result = await send;
      expect(result.content).toBe('hello!');
      expect(tokens).toEqual(['hel', 'lo!']);
      expect(thinking).toEqual(['pondering']);
      expect(result.usage).toEqual({
        inputTokens: 115,
        outputTokens: 20,
        cachedTokens: 100,
      });
    } finally {
      await provider.dispose();
    }
  });

  it('resumes the thread on the next turn and sends the system prompt once', async () => {
    const harness = new FakeCursorHarness();
    const provider = makeProvider(harness);
    try {
      const system = createMessage(MessageRole.System, 'sys');
      const user1 = createMessage(MessageRole.User, 'hi');
      const send1 = provider.sendChat({
        model: 'auto',
        sessionId: 's1',
        messages: [system, user1],
      });
      const run1 = await harness.nextSpawn();
      run1.emit(init());
      run1.emit(delta('hello'));
      run1.emit(resultEvent('hello'));
      await send1;

      const user2 = createMessage(MessageRole.User, 'and now?');
      const send2 = provider.sendChat({
        model: 'auto',
        sessionId: 's1',
        messages: [
          system,
          user1,
          createMessage(MessageRole.Assistant, 'hello'),
          user2,
        ],
      });
      const run2 = await harness.nextSpawn();
      expect(run2.options.args).toContain('--resume');
      expect(run2.options.args[run2.options.args.indexOf('--resume') + 1]).toBe(
        THREAD
      );
      // No tools and system prompt already sent: the raw user message.
      expect(run2.options.prompt).toBe('and now?');
      run2.emit(init());
      run2.emit(delta('done'));
      run2.emit(resultEvent('done'));
      expect((await send2).content).toBe('done');
    } finally {
      await provider.dispose();
    }
  });

  it('parks an MCP tool call and resumes the same process with the result', async () => {
    const harness = new FakeCursorHarness();
    const provider = makeProvider(harness);
    try {
      const system = createMessage(MessageRole.System, 'sys');
      const user = createMessage(MessageRole.User, 'read moby-dick.txt');
      const send1 = provider.sendChat({
        model: 'auto',
        sessionId: 's1',
        messages: [system, user],
        tools: [READ_TOOL],
      });
      const run1 = await harness.nextSpawn();
      run1.emit(init());
      run1.emit(delta('Reading it now.'));

      const client = await connectMcpClient(run1);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(['read_file']);

      const toolPromise = client.callTool({
        name: 'read_file',
        arguments: { path: 'moby-dick.txt' },
      });

      const round1 = await send1;
      expect(round1.content).toBe('Reading it now.');
      expect(round1.toolCalls).toHaveLength(1);
      const call = round1.toolCalls![0]!;
      expect(call.name).toBe('read_file');
      expect(JSON.parse(call.arguments)).toEqual({ path: 'moby-dick.txt' });

      const send2 = provider.sendChat({
        model: 'auto',
        sessionId: 's1',
        messages: [
          system,
          user,
          createMessage(
            MessageRole.Tool,
            'Call me Ishmael.',
            new Date(),
            undefined,
            {
              toolCallId: call.id,
              name: 'read_file',
            }
          ),
        ],
        tools: [READ_TOOL],
      });

      // The parked MCP handler resolves with the engine's result and the same
      // child process carries the turn to completion — no new spawn.
      const toolResult = (await toolPromise) as {
        content: Array<{ type: string; text: string }>;
      };
      expect(toolResult.content[0]?.text).toBe('Call me Ishmael.');
      expect(harness.runs).toHaveLength(1);

      run1.emit(delta('It begins with Ishmael.'));
      run1.emit(resultEvent('It begins with Ishmael.'));
      expect((await send2).content).toBe('It begins with Ishmael.');
      await client.close();
    } finally {
      await provider.dispose();
    }
  });

  it('aborts by killing the run and resumes the thread on the next turn', async () => {
    const harness = new FakeCursorHarness();
    const provider = makeProvider(harness);
    try {
      const user1 = createMessage(MessageRole.User, 'long task');
      const controller = new AbortController();
      const send1 = provider.sendChat({
        model: 'auto',
        sessionId: 's1',
        messages: [user1],
        signal: controller.signal,
      });
      const run1 = await harness.nextSpawn();
      run1.emit(init());
      run1.emit(delta('working...'));
      controller.abort();
      await expect(send1).rejects.toMatchObject({ name: 'AbortError' });
      expect(run1.killed).toBe(true);

      const send2 = provider.sendChat({
        model: 'auto',
        sessionId: 's1',
        messages: [
          user1,
          createMessage(MessageRole.Assistant, 'working...'),
          createMessage(MessageRole.User, 'continue please'),
        ],
      });
      const run2 = await harness.nextSpawn();
      expect(run2.options.args).toContain('--resume');
      run2.emit(init());
      run2.emit(delta('resumed'));
      run2.emit(resultEvent('resumed'));
      expect((await send2).content).toBe('resumed');
    } finally {
      await provider.dispose();
    }
  });

  it('rebuilds the session with a history replay when the anchor disappears', async () => {
    const harness = new FakeCursorHarness();
    const provider = makeProvider(harness);
    try {
      const user1 = createMessage(MessageRole.User, 'hi');
      const send1 = provider.sendChat({
        model: 'auto',
        sessionId: 's1',
        messages: [user1],
      });
      const run1 = await harness.nextSpawn();
      run1.emit(init());
      run1.emit(delta('hello'));
      run1.emit(resultEvent('hello'));
      await send1;

      // Edited history: the anchor message id is gone.
      const send2 = provider.sendChat({
        model: 'auto',
        sessionId: 's1',
        messages: [
          createMessage(MessageRole.User, 'hi (edited)'),
          createMessage(MessageRole.Assistant, 'hello'),
          createMessage(MessageRole.User, 'what did I say?'),
        ],
      });
      const run2 = await harness.nextSpawn();
      // A rebuilt bridge starts a fresh thread — no --resume — and replays the
      // conversation as context.
      expect(run2.options.args).not.toContain('--resume');
      expect(run2.options.prompt).toContain(
        'Conversation so far (for context):'
      );
      expect(run2.options.prompt).toContain('hi (edited)');
      expect(run2.options.prompt).toContain('what did I say?');
      run2.emit(init('thread-2'));
      run2.emit(delta('you said hi'));
      run2.emit(resultEvent('you said hi'));
      expect((await send2).content).toBe('you said hi');
    } finally {
      await provider.dispose();
    }
  });

  it('picks up toolset changes on a resumed thread via the per-spawn tool list', async () => {
    const harness = new FakeCursorHarness();
    const provider = makeProvider(harness);
    try {
      const user1 = createMessage(MessageRole.User, 'hi');
      const send1 = provider.sendChat({
        model: 'auto',
        sessionId: 's1',
        messages: [user1],
      });
      const run1 = await harness.nextSpawn();
      run1.emit(init());
      run1.emit(delta('hello'));
      run1.emit(resultEvent('hello'));
      await send1;

      // Each spawned process re-lists the bridge's tools, so a changed toolset
      // needs no rebuild — the thread resumes and the new tools are served.
      const send2 = provider.sendChat({
        model: 'auto',
        sessionId: 's1',
        messages: [
          user1,
          createMessage(MessageRole.Assistant, 'hello'),
          createMessage(MessageRole.User, 'read a file'),
        ],
        tools: [READ_TOOL],
      });
      const run2 = await harness.nextSpawn();
      expect(run2.options.args).toContain('--resume');
      // Tools are now advertised, so the environment note rides along.
      expect(run2.options.prompt).toContain('Environment note:');
      const client = await connectMcpClient(run2);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(['read_file']);
      await client.close();
      run2.emit(init());
      run2.emit(delta('ok'));
      run2.emit(resultEvent('ok'));
      expect((await send2).content).toBe('ok');
    } finally {
      await provider.dispose();
    }
  });

  it('serves multiple MCP sessions from one bridge (one per spawned process)', async () => {
    const harness = new FakeCursorHarness();
    const provider = makeProvider(harness);
    try {
      const user1 = createMessage(MessageRole.User, 'one');
      const send1 = provider.sendChat({
        model: 'auto',
        sessionId: 's1',
        messages: [user1],
        tools: [READ_TOOL],
      });
      const run1 = await harness.nextSpawn();
      run1.emit(init());
      // First CLI process claims an MCP session.
      const client1 = await connectMcpClient(run1);
      expect((await client1.listTools()).tools).toHaveLength(1);
      run1.emit(resultEvent('done one'));
      await send1;

      const send2 = provider.sendChat({
        model: 'auto',
        sessionId: 's1',
        messages: [
          user1,
          createMessage(MessageRole.Assistant, 'done one'),
          createMessage(MessageRole.User, 'two'),
        ],
        tools: [READ_TOOL],
      });
      const run2 = await harness.nextSpawn();
      run2.emit(init());
      // The next process must be able to open its own session on the same
      // endpoint — a single-session transport would reject this initialize
      // and leave every turn after the first without tools.
      const client2 = await connectMcpClient(run2);
      expect((await client2.listTools()).tools).toHaveLength(1);
      run2.emit(resultEvent('done two'));
      expect((await send2).content).toBe('done two');
      await client1.close();
      await client2.close();
    } finally {
      await provider.dispose();
    }
  });

  it('runs ephemeral requests as tool-less one-shots', async () => {
    const harness = new FakeCursorHarness();
    const provider = makeProvider(harness);
    try {
      const send = provider.sendChat({
        model: 'auto',
        sessionId: 's1',
        ephemeral: true,
        messages: [
          createMessage(MessageRole.System, 'Summarize titles.'),
          createMessage(MessageRole.User, 'make a title'),
        ],
      });
      const run = await harness.nextSpawn();
      expect(run.options.args).not.toContain('--resume');
      expect(run.options.args).not.toContain('--approve-mcps');
      // No MCP bridge is mounted for ephemeral runs, and every MCP tool is
      // denied so the user's global servers cannot execute either.
      await expect(
        readFile(join(run.options.cwd, '.cursor', 'mcp.json'), 'utf8')
      ).rejects.toThrow();
      const cliConfig = JSON.parse(
        await readFile(join(run.options.cwd, '.cursor', 'cli.json'), 'utf8')
      ) as { permissions: { deny: string[] } };
      expect(cliConfig.permissions.deny).toContain('Mcp(*:*)');
      run.emit(init());
      run.emit(resultEvent('A Great Title'));
      expect((await send).content).toBe('A Great Title');
    } finally {
      await provider.dispose();
    }
  });

  it('surfaces a helpful error when the CLI dies without a result', async () => {
    const harness = new FakeCursorHarness();
    const provider = makeProvider(harness);
    try {
      const send = provider.sendChat({
        model: 'auto',
        sessionId: 's1',
        messages: [createMessage(MessageRole.User, 'hi')],
      });
      const run = await harness.nextSpawn();
      run.emit(init());
      run.end(1);
      await expect(send).rejects.toThrow(/Cursor CLI is installed/);
    } finally {
      await provider.dispose();
    }
  });

  it('surfaces CLI stderr errors (plan restrictions) without the install hint', async () => {
    const harness = new FakeCursorHarness();
    const provider = makeProvider(harness);
    try {
      const send = provider.sendChat({
        model: 'claude-4.5-sonnet',
        sessionId: 's1',
        messages: [createMessage(MessageRole.User, 'hi')],
      });
      const run = await harness.nextSpawn();
      run.emit(init());
      // The real CLI reports plan gating as plain text on stderr, exit 0,
      // with no result event.
      run.stderrText =
        'ActionRequiredError: Named models unavailable Free plans can only use Auto.';
      run.end(0);
      const error = (await send.then(
        () => new Error('expected rejection'),
        (thrown: unknown) => thrown
      )) as Error;
      expect(error.message).toContain(
        'Named models unavailable Free plans can only use Auto.'
      );
      expect(error.message).not.toContain('Cursor CLI is installed');
    } finally {
      await provider.dispose();
    }
  });

  it('lists models by parsing the CLI models output', async () => {
    const harness = new FakeCursorHarness();
    const provider = makeProvider(harness);
    try {
      const listing = provider.listModels();
      const run = await harness.nextSpawn();
      expect(run.options.args).toEqual(['models']);
      run.write(
        [
          'Available models',
          '',
          'auto - Auto (current, default)',
          'composer-2.5 - Composer 2.5',
          'gpt-5.2 - GPT-5.2',
        ].join('\n')
      );
      run.end(0);
      const models = await listing;
      expect(models.map((model) => model.id)).toEqual([
        'auto',
        'composer-2.5',
        'gpt-5.2',
      ]);
      expect(models[0]?.displayName).toBe('Auto');
      expect(models[1]?.displayName).toBe('Composer 2.5');
    } finally {
      await provider.dispose();
    }
  });

  it('fails model listing with an install hint when the CLI is not signed in', async () => {
    const harness = new FakeCursorHarness();
    const provider = makeProvider(harness);
    try {
      const listing = provider.listModels();
      const run = await harness.nextSpawn();
      run.write('Not logged in\n');
      run.end(1);
      await expect(listing).rejects.toThrow(/cursor-agent login/);
    } finally {
      await provider.dispose();
    }
  });
});

describe('createCursorWorkspace', () => {
  it('writes the MCP config and permission denials for session runs', async () => {
    const workspace = await createCursorWorkspace({ mcpPort: 12345 });
    try {
      const mcpConfig = JSON.parse(
        await readFile(join(workspace.directory, '.cursor', 'mcp.json'), 'utf8')
      ) as { mcpServers: { justcode: { url: string } } };
      expect(mcpConfig.mcpServers.justcode.url).toBe(
        'http://127.0.0.1:12345/mcp'
      );
      const cliConfig = JSON.parse(
        await readFile(join(workspace.directory, '.cursor', 'cli.json'), 'utf8')
      ) as { permissions: { allow: string[]; deny: string[] } };
      expect(cliConfig.permissions.allow).toContain('Mcp(justcode:*)');
      for (const rule of [
        'Shell(*)',
        'Write(**)',
        'Read(**)',
        'Delete(**)',
        'WebFetch(*)',
      ]) {
        expect(cliConfig.permissions.deny).toContain(rule);
      }
      expect(cliConfig.permissions.deny).not.toContain('Mcp(*:*)');
    } finally {
      await workspace.cleanup();
    }
  });
});
