import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUB_AGENT_MAX_ITERATIONS,
  runSubAgent,
} from '@core/application/sub-agent-runner';
import type {
  ChatRequest,
  ChatResult,
  ProviderClient,
} from '@core/ports/chat-model';
import { ProviderId } from '@core/ports/provider-catalog';
import type { Tool } from '@core/ports/tool';

function providerFromResponses(
  responses: ChatResult[],
  requests: ChatRequest[] = []
): ProviderClient {
  let index = 0;
  return {
    providerId: ProviderId.Ollama,
    async sendChat(request) {
      requests.push(request);
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return response ?? { content: '' };
    },
    async listModels() {
      return [];
    },
    getDefaultModel() {
      return undefined;
    },
  };
}

class EchoTool implements Tool {
  public readonly executed: string[] = [];
  public readonly requiresApproval = false;
  public readonly definition = {
    name: 'echo',
    description: 'Echoes its input.',
    parameters: { type: 'object', properties: {} },
  };

  public describe(): { title: string } {
    return { title: 'echo: hi' };
  }

  public async execute(rawArguments: string): Promise<{ content: string }> {
    this.executed.push(rawArguments);
    return { content: `echoed ${rawArguments}` };
  }
}

describe('runSubAgent', () => {
  it('returns the final reply when the model uses no tools', async () => {
    const requests: ChatRequest[] = [];
    const result = await runSubAgent({
      provider: providerFromResponses([{ content: 'the report' }], requests),
      model: 'test-model',
      tools: [],
      prompt: 'investigate',
      systemPrompt: 'you are a sub agent',
      workspaceRoot: '/workspace',
      sessionId: 'subagent-test',
    });

    expect(result.summary).toBe('the report');
    expect(result.toolUseCount).toBe(0);
    // The run's own session id rides on every request (session-oriented
    // providers key their live session — and thus real tool calling — on it).
    expect(requests[0]?.sessionId).toBe('subagent-test');
    expect(requests[0]?.ephemeral).toBeUndefined();
    expect(result.messages[0]?.role).toBe('user');
    expect(result.messages.at(-1)?.role).toBe('assistant');
  });

  it('executes tool calls and feeds results back to the model', async () => {
    const tool = new EchoTool();
    const requests: ChatRequest[] = [];
    const activities: string[] = [];
    const result = await runSubAgent({
      provider: providerFromResponses(
        [
          {
            content: '',
            toolCalls: [{ id: 'call-1', name: 'echo', arguments: '{"a":1}' }],
          },
          { content: 'done' },
        ],
        requests
      ),
      model: 'test-model',
      tools: [tool],
      prompt: 'do it',
      systemPrompt: 'sub agent',
      workspaceRoot: '/workspace',
      sessionId: 'subagent-test',
      onToolActivity: (activity) => activities.push(activity.view.title),
    });

    expect(tool.executed).toEqual(['{"a":1}']);
    expect(result.summary).toBe('done');
    expect(result.toolUseCount).toBe(1);
    expect(activities).toEqual(['echo: hi']);
    // The second request carries the tool result back to the model.
    const secondRequest = requests[1];
    expect(
      secondRequest?.messages.some(
        (message) => message.role === 'tool' && message.toolCallId === 'call-1'
      )
    ).toBe(true);
  });

  it('answers unknown tool calls with an error result instead of crashing', async () => {
    const result = await runSubAgent({
      provider: providerFromResponses([
        {
          content: '',
          toolCalls: [{ id: 'call-1', name: 'missing', arguments: '{}' }],
        },
        { content: 'recovered' },
      ]),
      model: 'test-model',
      tools: [new EchoTool()],
      prompt: 'do it',
      systemPrompt: 'sub agent',
      workspaceRoot: '/workspace',
      sessionId: 'subagent-test',
    });

    expect(result.summary).toBe('recovered');
    const errorMessage = result.messages.find(
      (message) => message.role === 'tool'
    );
    expect(errorMessage?.isError).toBe(true);
    expect(errorMessage?.content).toContain('Unknown tool: missing');
  });

  it('stops at the iteration cap instead of looping forever', async () => {
    const result = await runSubAgent({
      provider: providerFromResponses([
        {
          content: '',
          toolCalls: [{ id: 'call-1', name: 'echo', arguments: '{}' }],
        },
      ]),
      model: 'test-model',
      tools: [new EchoTool()],
      prompt: 'loop',
      systemPrompt: 'sub agent',
      workspaceRoot: '/workspace',
      sessionId: 'subagent-test',
      maxIterations: 3,
    });

    expect(result.toolUseCount).toBe(3);
    expect(result.summary).toContain('3-iteration limit');
  });

  it('has a sane default iteration cap', () => {
    expect(DEFAULT_SUB_AGENT_MAX_ITERATIONS).toBeGreaterThan(0);
  });

  it('throws an AbortError when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runSubAgent({
        provider: providerFromResponses([{ content: 'never' }]),
        model: 'test-model',
        tools: [],
        prompt: 'x',
        systemPrompt: 'sub agent',
        workspaceRoot: '/workspace',
        sessionId: 'subagent-test',
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('accumulates usage across steps', async () => {
    const usage = { inputTokens: 10, outputTokens: 5, cachedTokens: 0 };
    const result = await runSubAgent({
      provider: providerFromResponses([
        {
          content: '',
          toolCalls: [{ id: 'c1', name: 'echo', arguments: '{}' }],
          usage,
        },
        { content: 'done', usage },
      ]),
      model: 'test-model',
      tools: [new EchoTool()],
      prompt: 'x',
      systemPrompt: 'sub agent',
      workspaceRoot: '/workspace',
      sessionId: 'subagent-test',
    });

    expect(result.usage).toEqual({
      inputTokens: 20,
      outputTokens: 10,
      cachedTokens: 0,
    });
  });
});
