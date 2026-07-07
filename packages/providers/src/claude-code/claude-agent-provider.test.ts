import { describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  Options,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';

import { createMessage, type ChatMessage } from '@core/domain/message';
import { ClaudeAgentProvider } from './claude-agent-provider.js';

/**
 * Harness standing in for the Agent SDK's `query()`: exposes the pushable
 * output stream (what the CLI would emit) and captures the prompt input stream
 * (what the provider forwards), plus the options — including the in-process
 * MCP server instance, which tests drive through a real in-memory MCP client.
 */
class FakeQueryHarness {
  public options: Options | undefined;
  /** Options of every query started, in order (sessions + ephemeral runs). */
  public optionsHistory: Options[] = [];
  public prompts: SDKUserMessage[] = [];
  public modelChanges: string[] = [];
  public mcpServerUpdates = 0;
  public interrupted = false;

  private readonly output: SDKMessage[] = [];
  private outputWaiter:
    | ((value: IteratorResult<SDKMessage, void>) => void)
    | null = null;
  private promptArrival: (() => void) | null = null;

  public emit(message: SDKMessage): void {
    const waiter = this.outputWaiter;
    if (waiter) {
      this.outputWaiter = null;
      waiter({ value: message, done: false });
      return;
    }
    this.output.push(message);
  }

  /** Resolves once the provider has forwarded another prompt message. */
  public async nextPrompt(): Promise<SDKUserMessage> {
    while (this.prompts.length === 0) {
      await new Promise<void>((resolve) => {
        this.promptArrival = resolve;
      });
    }
    return this.prompts.shift() as SDKUserMessage;
  }

  /** Connects a real MCP client to the server instance the provider built. */
  public async connectMcpClient(): Promise<Client> {
    const config = this.options?.mcpServers?.['justcode'] as
      | { instance?: McpServer }
      | undefined;
    if (!config?.instance) throw new Error('no MCP server registered');
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await (
      config.instance as unknown as {
        connect: (t: unknown) => Promise<void>;
      }
    ).connect(serverTransport);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientTransport);
    return client;
  }

  public createQuery = (params: {
    prompt: string | AsyncIterable<SDKUserMessage>;
    options?: Options;
  }): Query => {
    this.options = params.options;
    if (params.options) this.optionsHistory.push(params.options);
    if (typeof params.prompt !== 'string') {
      void (async () => {
        for await (const message of params.prompt as AsyncIterable<SDKUserMessage>) {
          this.prompts.push(message);
          this.promptArrival?.();
          this.promptArrival = null;
        }
      })();
    }

    const harness = this;
    const generator: AsyncGenerator<SDKMessage, void> = {
      next(): Promise<IteratorResult<SDKMessage, void>> {
        const queued = harness.output.shift();
        if (queued) return Promise.resolve({ value: queued, done: false });
        return new Promise((resolve) => {
          harness.outputWaiter = resolve;
        });
      },
      return(): Promise<IteratorResult<SDKMessage, void>> {
        return Promise.resolve({ value: undefined, done: true });
      },
      throw(): Promise<IteratorResult<SDKMessage, void>> {
        return Promise.resolve({ value: undefined, done: true });
      },
      [Symbol.asyncIterator]() {
        return this;
      },
      [Symbol.asyncDispose](): Promise<void> {
        return Promise.resolve();
      },
    };

    return Object.assign(generator, {
      interrupt: async () => {
        harness.interrupted = true;
      },
      setModel: async (model?: string) => {
        harness.modelChanges.push(model ?? '');
      },
      setMcpServers: async () => {
        harness.mcpServerUpdates += 1;
        return {};
      },
    }) as unknown as Query;
  };
}

function textDelta(text: string): SDKMessage {
  return {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    },
    parent_tool_use_id: null,
    uuid: '00000000-0000-0000-0000-000000000000',
    session_id: 'test',
  } as unknown as SDKMessage;
}

function successResult(text: string): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 1,
    result: text,
    stop_reason: 'end_turn',
    total_cost_usd: 0.05,
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 5,
    },
    modelUsage: {},
    permission_denials: [],
    uuid: '00000000-0000-0000-0000-000000000001',
    session_id: 'test',
  } as unknown as SDKMessage;
}

const READ_TOOL = {
  name: 'read_file',
  description: 'Read a file',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
};

describe('ClaudeAgentProvider', () => {
  it('streams text deltas and maps the final result and usage', async () => {
    const harness = new FakeQueryHarness();
    const provider = new ClaudeAgentProvider({
      createQuery: harness.createQuery,
    });

    const tokens: string[] = [];
    const send = provider.sendChat({
      model: 'claude-sonnet-5',
      sessionId: 's1',
      messages: [
        createMessage('system', 'You are helpful.'),
        createMessage('user', 'hello'),
      ],
      onToken: (token) => tokens.push(token),
    });

    const prompt = await harness.nextPrompt();
    expect(prompt.message.role).toBe('user');
    harness.emit(textDelta('Hi '));
    harness.emit(textDelta('there'));
    harness.emit(successResult('Hi there'));

    const result = await send;
    expect(result.content).toBe('Hi there');
    expect(tokens).toEqual(['Hi ', 'there']);
    // input is the full context: uncached + cache reads + cache writes.
    expect(result.usage).toEqual({
      inputTokens: 115,
      outputTokens: 20,
      cachedTokens: 100,
      cost: 0.05,
    });
    // The system message travels as the session's system prompt, not as input.
    expect(harness.options?.systemPrompt).toBe('You are helpful.');
    // justcode owns the loop: every Claude Code built-in is disabled.
    expect(harness.options?.tools).toEqual([]);
  });

  it('passes the executable path and config-dir env to the spawned runtime', async () => {
    const harness = new FakeQueryHarness();
    const provider = new ClaudeAgentProvider({
      createQuery: harness.createQuery,
      executablePath: '/Users/kingeke/.local/bin/claude',
      configDir: '~/.claude-work',
    });

    const send = provider.sendChat({
      model: 'claude-sonnet-5',
      sessionId: 's1',
      messages: [createMessage('user', 'hi')],
    });
    await harness.nextPrompt();
    harness.emit(successResult('hey'));
    await send;

    expect(harness.options?.pathToClaudeCodeExecutable).toBe(
      '/Users/kingeke/.local/bin/claude'
    );
    // The leading `~` is expanded and CLAUDE_CONFIG_DIR selects the account,
    // while the rest of process.env is preserved (env REPLACES the subprocess
    // environment, so PATH etc. must still be present).
    expect(harness.options?.env?.['CLAUDE_CONFIG_DIR']).toBe(
      join(homedir(), '.claude-work')
    );
    expect(harness.options?.env?.['PATH']).toBe(process.env['PATH']);
  });

  it('omits env entirely when no config-dir is set', async () => {
    const harness = new FakeQueryHarness();
    const provider = new ClaudeAgentProvider({
      createQuery: harness.createQuery,
    });

    const send = provider.sendChat({
      model: 'claude-sonnet-5',
      sessionId: 's1',
      messages: [createMessage('user', 'hi')],
    });
    await harness.nextPrompt();
    harness.emit(successResult('hey'));
    await send;

    // No override → the subprocess inherits process.env untouched.
    expect(harness.options?.env).toBeUndefined();
    expect(harness.options?.pathToClaudeCodeExecutable).toBeUndefined();
  });

  it('surfaces the error when the model probe cannot be reached', async () => {
    // The fake Query exposes no `supportedModels`, so every probe attempt fails.
    // listModels must reject (so the picker shows the real reason, e.g. Claude
    // Code not installed/signed in) rather than returning a misleading list.
    const harness = new FakeQueryHarness();
    const provider = new ClaudeAgentProvider({
      createQuery: harness.createQuery,
    });

    await expect(provider.listModels()).rejects.toBeDefined();
  });

  it('round-trips a tool call through the blocking MCP handler', async () => {
    const harness = new FakeQueryHarness();
    const provider = new ClaudeAgentProvider({
      createQuery: harness.createQuery,
    });

    const history: ChatMessage[] = [
      createMessage('system', 'sys'),
      createMessage('user', 'read moby-dick.txt'),
    ];
    const firstRound = provider.sendChat({
      model: 'claude-sonnet-5',
      sessionId: 's1',
      messages: history,
      tools: [READ_TOOL],
    });

    await harness.nextPrompt();
    harness.emit(textDelta('Reading it now.'));

    // The model "invokes" the MCP tool; the handler parks the call, so the
    // client-side promise stays pending until the engine supplies the result.
    const client = await harness.connectMcpClient();
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(['read_file']);

    const toolCallPromise = client.callTool({
      name: 'read_file',
      arguments: { path: 'moby-dick.txt' },
    });

    const round1 = await firstRound;
    expect(round1.content).toBe('Reading it now.');
    expect(round1.toolCalls).toHaveLength(1);
    const call = round1.toolCalls?.[0];
    if (!call) throw new Error('expected a tool call');
    expect(call.name).toBe('read_file');
    expect(JSON.parse(call.arguments)).toEqual({
      path: 'moby-dick.txt',
    });

    // Engine executed the tool; the next sendChat carries the result.
    history.push(
      createMessage('assistant', round1.content, new Date(), undefined, {
        toolCalls: [call],
      }),
      createMessage('tool', 'Call me Ishmael.', new Date(), undefined, {
        toolCallId: call.id,
        name: 'read_file',
      })
    );
    const secondRound = provider.sendChat({
      model: 'claude-sonnet-5',
      sessionId: 's1',
      messages: history,
      tools: [READ_TOOL],
    });

    const handlerResult = (await toolCallPromise) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(handlerResult.content[0]?.text).toBe('Call me Ishmael.');
    expect(handlerResult.isError).toBeUndefined();

    harness.emit(textDelta('A classic opening.'));
    harness.emit(successResult('A classic opening.'));
    const round2 = await secondRound;
    expect(round2.content).toBe('A classic opening.');
    expect(round2.toolCalls).toBeUndefined();
  });

  it('batches concurrently dispatched task calls into one round', async () => {
    const harness = new FakeQueryHarness();
    const provider = new ClaudeAgentProvider({
      createQuery: harness.createQuery,
    });

    const TASK_TOOL = {
      name: 'task',
      description: 'Delegate to a sub agent',
      parameters: { type: 'object' },
    };
    const history: ChatMessage[] = [
      createMessage('user', 'build it with sub agents'),
    ];
    const send = provider.sendChat({
      model: 'claude-sonnet-5',
      sessionId: 's1',
      messages: history,
      tools: [TASK_TOOL, READ_TOOL],
    });
    await harness.nextPrompt();

    // The model dispatches two parallel task tool_use blocks: both MCP
    // invocations park before the engine answers either.
    const client = await harness.connectMcpClient();
    const first = client.callTool({
      name: 'task',
      arguments: { agent_type: 'general', description: 'a', prompt: 'a' },
    });
    const second = client.callTool({
      name: 'task',
      arguments: { agent_type: 'general', description: 'b', prompt: 'b' },
    });

    // One ChatResult carries BOTH calls — that's what lets the engine run the
    // sub agents concurrently instead of one per round trip.
    const round = await send;
    expect(round.toolCalls).toHaveLength(2);
    expect(round.toolCalls?.map((call) => call.name)).toEqual(['task', 'task']);

    // Answer both on the next sendChat so the parked handlers resolve.
    const calls = round.toolCalls!;
    history.push(
      createMessage('assistant', '', new Date(), undefined, {
        toolCalls: calls,
      }),
      createMessage('tool', 'report a', new Date(), undefined, {
        toolCallId: calls[0]!.id,
        name: 'task',
      }),
      createMessage('tool', 'report b', new Date(), undefined, {
        toolCallId: calls[1]!.id,
        name: 'task',
      })
    );
    const secondRound = provider.sendChat({
      model: 'claude-sonnet-5',
      sessionId: 's1',
      messages: history,
      tools: [TASK_TOOL, READ_TOOL],
    });
    await Promise.all([first, second]);
    harness.emit(successResult('done'));
    const final = await secondRound;
    expect(final.content).toBe('done');
  });

  it('switches model and re-registers tools mid-session', async () => {
    const harness = new FakeQueryHarness();
    const provider = new ClaudeAgentProvider({
      createQuery: harness.createQuery,
    });

    const history: ChatMessage[] = [createMessage('user', 'hi')];
    const first = provider.sendChat({
      model: 'claude-sonnet-5',
      sessionId: 's1',
      messages: history,
      tools: [READ_TOOL],
    });
    await harness.nextPrompt();
    harness.emit(successResult('hello'));
    await first;

    history.push(createMessage('assistant', 'hello'));
    history.push(createMessage('user', 'and now?'));
    const second = provider.sendChat({
      model: 'claude-opus-4-8',
      sessionId: 's1',
      messages: history,
      tools: [
        READ_TOOL,
        { name: 'write_file', description: 'Write', parameters: {} },
      ],
    });
    await harness.nextPrompt();
    harness.emit(successResult('done'));
    await second;

    expect(harness.modelChanges).toEqual(['claude-opus-4-8']);
    expect(harness.mcpServerUpdates).toBe(1);
  });

  it('runs ephemeral requests outside the session (title-generation flow)', async () => {
    const harness = new FakeQueryHarness();
    const provider = new ClaudeAgentProvider({
      createQuery: harness.createQuery,
    });

    // The engine titles a session by awaiting an ephemeral call with the SAME
    // sessionId *before* the first real turn. It must not become the session.
    const titleCall = provider.sendChat({
      model: 'claude-sonnet-5',
      sessionId: 's1',
      ephemeral: true,
      messages: [
        createMessage('system', 'You generate a short title.'),
        createMessage('user', 'hey how are u'),
      ],
    });
    await harness.nextPrompt();
    harness.emit(successResult('Casual Greeting Chat'));
    const title = await titleCall;
    expect(title.content).toBe('Casual Greeting Chat');

    const chatCall = provider.sendChat({
      model: 'claude-sonnet-5',
      sessionId: 's1',
      messages: [
        createMessage('system', 'You are JustCode.'),
        createMessage('user', 'hey how are u'),
      ],
    });
    await harness.nextPrompt();
    harness.emit(successResult('Doing great!'));
    const chat = await chatCall;
    expect(chat.content).toBe('Doing great!');

    // Two separate queries, and the persistent session carries the chat
    // system prompt — not the title generator's.
    expect(harness.optionsHistory).toHaveLength(2);
    expect(harness.optionsHistory[0]?.systemPrompt).toBe(
      'You generate a short title.'
    );
    expect(harness.optionsHistory[1]?.systemPrompt).toBe('You are JustCode.');
  });

  it('rebuilds the session when the conversation diverges (e.g. compaction)', async () => {
    const harness = new FakeQueryHarness();
    const provider = new ClaudeAgentProvider({
      createQuery: harness.createQuery,
    });

    const first = provider.sendChat({
      model: 'claude-sonnet-5',
      sessionId: 's1',
      messages: [createMessage('user', 'hello')],
    });
    await harness.nextPrompt();
    harness.emit(successResult('hi'));
    await first;

    // Post-compaction the history is replaced wholesale: no message id the
    // bridge has seen survives, so the stale session must be rebuilt.
    const second = provider.sendChat({
      model: 'claude-sonnet-5',
      sessionId: 's1',
      messages: [
        createMessage('user', 'Summary of the conversation so far: greetings.'),
        createMessage('user', 'and now?'),
      ],
    });
    // A single rebuilt turn carries the replayed summary folded into the new
    // user message (a separate context message would return an empty turn).
    const turn = await harness.nextPrompt();
    const turnText = JSON.stringify(turn.message.content);
    expect(turnText).toContain('Summary of the conversation so far');
    expect(turnText).toContain('and now?');
    harness.emit(successResult('onward'));
    const result = await second;
    expect(result.content).toBe('onward');
    expect(harness.optionsHistory).toHaveLength(2);
  });

  it('recovers after a user interrupt: drains the aborted turn, answers the next', async () => {
    const harness = new FakeQueryHarness();
    const provider = new ClaudeAgentProvider({
      createQuery: harness.createQuery,
    });

    const history: ChatMessage[] = [createMessage('user', 'do something big')];
    const controller = new AbortController();
    const aborted = provider.sendChat({
      model: 'claude-sonnet-5',
      sessionId: 's1',
      messages: history,
      signal: controller.signal,
    });
    await harness.nextPrompt();
    harness.emit(textDelta('Working on'));

    // User hits stop: the provider interrupts the runtime; the engine abandons
    // the promise, and the runtime answers the interrupt with a result that
    // must be consumed off the stream — not left for the next turn to misread.
    controller.abort();
    await Promise.resolve();
    expect(harness.interrupted).toBe(true);
    harness.emit(successResult(''));
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });

    // Next message on the same session gets a clean turn and a real answer.
    history.push(createMessage('user', 'hey'));
    const next = provider.sendChat({
      model: 'claude-sonnet-5',
      sessionId: 's1',
      messages: history,
    });
    await harness.nextPrompt();
    harness.emit(successResult('hello again'));
    const result = await next;
    expect(result.content).toBe('hello again');
  });

  it('replays prior history as context when a conversation is resumed', async () => {
    const harness = new FakeQueryHarness();
    const provider = new ClaudeAgentProvider({
      createQuery: harness.createQuery,
    });

    // A conversation restored from disk: the session process never saw it.
    const send = provider.sendChat({
      model: 'claude-sonnet-5',
      sessionId: 's1',
      messages: [
        createMessage('system', 'sys'),
        createMessage('user', 'first question'),
        createMessage('assistant', 'first answer'),
        createMessage('user', 'follow-up'),
      ],
    });

    // The missed history rides along inside the querying user message rather
    // than a separate `shouldQuery: false` message (which the SDK answers with
    // an empty turn), so a single prompt carries both the context and the
    // follow-up.
    const turn = await harness.nextPrompt();
    expect(turn.shouldQuery).not.toBe(false);
    const text = JSON.stringify(turn.message.content);
    expect(text).toContain('first question');
    expect(text).toContain('first answer');
    expect(text).toContain('follow-up');

    harness.emit(successResult('answered'));
    const result = await send;
    expect(result.content).toBe('answered');
  });
});
