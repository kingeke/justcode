import { describe, expect, it } from 'vitest';
import { TaskTool } from '@runtime/tools/task-tool';
import { ToolName } from '@core/domain/tool-name';
import {
  SubAgentActivityPhase,
  SubAgentRunStatus,
  SubAgentType,
  type SubAgentActivityEvent,
  type SubAgentRun,
} from '@core/domain/sub-agent';
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

function stubTool(name: string): Tool {
  return {
    requiresApproval: false,
    definition: { name, description: name, parameters: { type: 'object' } },
    describe: () => ({ title: name }),
    execute: async () => ({ content: `${name} ran` }),
  };
}

const taskArguments = JSON.stringify({
  agent_type: SubAgentType.Explorer,
  description: 'Find the bug',
  prompt: 'Locate the bug in auth and report the file and line.',
});

describe('TaskTool', () => {
  it('describes a call with its agent type and description', () => {
    const tool = new TaskTool(() => ({
      provider: providerFromResponses([]),
      tools: [],
    }));
    const view = tool.describe(taskArguments);
    expect(view.title).toBe('task (explorer): Find the bug');
    expect(view.preview).toContain('Locate the bug');
  });

  it('rejects invalid arguments', async () => {
    const tool = new TaskTool(() => ({
      provider: providerFromResponses([]),
      tools: [],
    }));
    const result = await tool.execute('{"agent_type":"bogus"}', {
      workspaceRoot: '/workspace',
      model: 'test-model',
    });
    expect(result.isError).toBe(true);
  });

  it('fails cleanly when no model is available', async () => {
    const tool = new TaskTool(() => ({
      provider: providerFromResponses([]),
      tools: [],
    }));
    const result = await tool.execute(taskArguments, {
      workspaceRoot: '/workspace',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('No model');
  });

  it('runs the sub agent and returns its report', async () => {
    const requests: ChatRequest[] = [];
    const tool = new TaskTool(() => ({
      provider: providerFromResponses(
        [{ content: 'bug is in auth.ts:42' }],
        requests
      ),
      tools: [stubTool(ToolName.ReadFile)],
    }));
    const result = await tool.execute(taskArguments, {
      workspaceRoot: '/workspace',
      model: 'test-model',
      toolCallId: 'call-9',
    });
    expect(result.isError).toBeUndefined();
    expect(result.content).toBe('bug is in auth.ts:42');
    expect(requests[0]?.model).toBe('test-model');
  });

  it("only advertises the agent type's allowed tools (never task itself)", async () => {
    const requests: ChatRequest[] = [];
    const tool = new TaskTool(() => ({
      provider: providerFromResponses([{ content: 'ok' }], requests),
      tools: [
        stubTool(ToolName.ReadFile),
        stubTool(ToolName.Bash),
        stubTool(ToolName.Task),
        stubTool(ToolName.Question),
      ],
    }));
    await tool.execute(taskArguments, {
      workspaceRoot: '/workspace',
      model: 'test-model',
    });
    const advertised = (requests[0]?.tools ?? []).map((t) => t.name);
    expect(advertised).toContain(ToolName.ReadFile);
    expect(advertised).not.toContain(ToolName.Bash);
    expect(advertised).not.toContain(ToolName.Task);
    expect(advertised).not.toContain(ToolName.Question);
  });

  it('records the run transcript and emits start/end activity', async () => {
    const runs: SubAgentRun[] = [];
    const events: SubAgentActivityEvent[] = [];
    const tool = new TaskTool(() => ({
      provider: providerFromResponses([{ content: 'report' }]),
      tools: [],
    }));
    await tool.execute(taskArguments, {
      workspaceRoot: '/workspace',
      model: 'test-model',
      toolCallId: 'call-1',
      recordSubAgentRun: (run) => runs.push(run),
      onSubAgentActivity: (event) => events.push(event),
    });

    expect(runs[0]?.status).toBe(SubAgentRunStatus.Running);
    const finalRun = runs.at(-1);
    expect(finalRun?.id).toBe('call-1');
    expect(finalRun?.status).toBe(SubAgentRunStatus.Completed);
    expect(finalRun?.summary).toBe('report');
    expect(finalRun?.messages.length).toBeGreaterThan(0);
    expect(events[0]?.phase).toBe(SubAgentActivityPhase.Start);
    // The start event carries the live run object so an in-process host can
    // serve the full transcript while the sub agent is still working.
    expect(events[0]?.run?.id).toBe('call-1');
    expect(events[0]?.run?.messages).toBe(finalRun?.messages);
    expect(events.at(-1)?.phase).toBe(SubAgentActivityPhase.End);
    expect(events.at(-1)?.status).toBe(SubAgentRunStatus.Completed);
  });

  it('marks the run failed when the provider throws', async () => {
    const runs: SubAgentRun[] = [];
    const tool = new TaskTool(() => ({
      provider: {
        providerId: ProviderId.Ollama,
        async sendChat() {
          throw new Error('boom');
        },
        async listModels() {
          return [];
        },
        getDefaultModel() {
          return undefined;
        },
      },
      tools: [],
    }));
    const result = await tool.execute(taskArguments, {
      workspaceRoot: '/workspace',
      model: 'test-model',
      recordSubAgentRun: (run) => runs.push(run),
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('boom');
    expect(runs.at(-1)?.status).toBe(SubAgentRunStatus.Failed);
  });

  it('runs on a per-run session and closes it when the run ends', async () => {
    const requests: ChatRequest[] = [];
    const closed: string[] = [];
    const provider = providerFromResponses([{ content: 'ok' }], requests);
    provider.closeSession = (sessionId: string) => closed.push(sessionId);
    const tool = new TaskTool(() => ({ provider, tools: [] }));

    await tool.execute(taskArguments, {
      workspaceRoot: '/workspace',
      model: 'test-model',
      toolCallId: 'call-7',
    });

    expect(requests[0]?.sessionId).toBe('subagent-call-7');
    expect(requests[0]?.ephemeral).toBeUndefined();
    expect(closed).toEqual(['subagent-call-7']);
  });

  it('uses the configurable system prompt when provided', async () => {
    const requests: ChatRequest[] = [];
    const tool = new TaskTool(
      () => ({
        provider: providerFromResponses([{ content: 'ok' }], requests),
        tools: [],
      }),
      () => 'CUSTOM SUB AGENT PROMPT'
    );
    await tool.execute(taskArguments, {
      workspaceRoot: '/workspace',
      model: 'test-model',
    });
    expect(requests[0]?.messages[0]?.content).toContain(
      'CUSTOM SUB AGENT PROMPT'
    );
  });

  it('advertises custom sub agents in the schema and runs them', async () => {
    const requests: ChatRequest[] = [];
    const tool = new TaskTool(
      () => ({
        provider: providerFromResponses([{ content: 'reviewed' }], requests),
        tools: [stubTool(ToolName.ReadFile), stubTool(ToolName.Bash)],
      }),
      undefined,
      () => ({
        reviewer: {
          name: 'Reviewer',
          summary: 'Reviews code.',
          systemPrompt: 'You review code.',
          readOnly: true,
        },
      })
    );

    const parameters = tool.definition.parameters as {
      properties: { agent_type: { enum: string[] } };
    };
    expect(parameters.properties.agent_type.enum).toContain('reviewer');
    expect(tool.definition.description).toContain('"reviewer": Reviews code.');

    const result = await tool.execute(
      JSON.stringify({
        agent_type: 'reviewer',
        description: 'Review the diff',
        prompt: 'Review the change and report issues.',
      }),
      { workspaceRoot: '/workspace', model: 'test-model' }
    );
    expect(result.isError).toBeUndefined();
    expect(result.content).toBe('reviewed');
    // Custom prompt is used, and read-only agents never see bash.
    expect(requests[0]?.messages[0]?.content).toContain('You review code.');
    expect(requests[0]?.tools?.map((t) => t.name)).toEqual([ToolName.ReadFile]);
  });

  it('rejects an unknown agent type with the known ids', async () => {
    const tool = new TaskTool(() => ({
      provider: providerFromResponses([]),
      tools: [],
    }));
    const result = await tool.execute(
      JSON.stringify({
        agent_type: 'ghost',
        description: 'x',
        prompt: 'do something',
      }),
      { workspaceRoot: '/workspace', model: 'test-model' }
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Unknown agent_type "ghost"');
    expect(result.content).toContain('"explorer"');
  });
});
