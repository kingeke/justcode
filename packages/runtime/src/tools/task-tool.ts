import type {
  Tool,
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocationView,
  ToolResult,
} from '@core/ports/tool';
import type { ProviderClient } from '@core/ports/chat-model';
import { ToolName } from '@core/domain/tool-name';
import {
  SUB_AGENT_CONFIGS,
  SubAgentActivityPhase,
  SubAgentRunStatus,
  SubAgentType,
  isSubAgentType,
  type SubAgentRun,
} from '@core/domain/sub-agent';
import { runSubAgent } from '@core/application/sub-agent-runner';

interface TaskArguments {
  agent_type: SubAgentType;
  description: string;
  prompt: string;
}

/**
 * Dependencies resolved per call (not at construction) so the sub agent always
 * runs against the live provider and tool registry — including MCP tools that
 * connected after startup.
 */
export interface TaskToolDependencies {
  provider: ProviderClient;
  /** Every tool currently available; filtered per agent type before running. */
  tools: Tool[];
  /** Fallback model when the execution context doesn't carry the turn's model. */
  defaultModel?: string;
}

/**
 * Spawns a sub agent: a child agentic loop that works on a delegated task with
 * a restricted toolset and returns only its final report to the parent model.
 * The run's full transcript is recorded on the conversation (via
 * `context.recordSubAgentRun`) so the user can review what the sub agent did.
 */
export class TaskTool implements Tool {
  public readonly requiresApproval = false;

  public readonly definition: ToolDefinition;

  public constructor(
    private readonly resolveDependencies: () => TaskToolDependencies,
    /**
     * Returns the system prompt for a sub agent type. Read per run so prompt
     * edits (settings/config) take effect without a rebuild; falls back to the
     * built-in prompt when unset.
     */
    private readonly getSystemPrompt?: (type: SubAgentType) => string
  ) {
    const typeSummaries = Object.entries(SUB_AGENT_CONFIGS)
      .map(([type, config]) => `"${type}": ${config.summary}`)
      .join(' ');
    this.definition = {
      name: ToolName.Task,
      description:
        'Delegate a self-contained task to a sub agent that works autonomously ' +
        'with its own tools and context, then reports back a single summary. ' +
        'Use it for broad or token-heavy work (research, multi-file exploration, ' +
        'an isolated implementation task) so the main conversation stays small. ' +
        'The sub agent cannot talk to the user and only its final report comes ' +
        'back — include every detail it needs in "prompt". When you have ' +
        'several INDEPENDENT tasks, emit all their task calls together in one ' +
        'response: they run in parallel. Calling task once per turn runs them ' +
        `one at a time. Agent types: ${typeSummaries}`,
      parameters: {
        type: 'object',
        properties: {
          agent_type: {
            type: 'string',
            enum: Object.values(SubAgentType),
            description: 'The kind of sub agent to spawn.',
          },
          description: {
            type: 'string',
            description:
              'A short (3-7 word) human-readable label for the task, shown in the UI.',
          },
          prompt: {
            type: 'string',
            description:
              'The full task for the sub agent: what to do, all relevant context, ' +
              'and exactly what its final report must contain.',
          },
        },
        required: ['agent_type', 'description', 'prompt'],
        additionalProperties: false,
      },
    };
  }

  public describe(rawArguments: string): ToolInvocationView {
    const parsed = tryParse(rawArguments);
    if (!parsed) {
      return { title: 'task (unparseable arguments)' };
    }
    return {
      title: `task (${parsed.agent_type}): ${parsed.description}`,
      preview: parsed.prompt,
    };
  }

  public async execute(
    rawArguments: string,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const parsed = tryParse(rawArguments);
    if (!parsed) {
      return {
        content:
          'Invalid arguments: expected JSON with "agent_type" ' +
          `(one of ${Object.values(SubAgentType).join(', ')}), "description", and "prompt" strings.`,
        isError: true,
      };
    }

    const dependencies = this.resolveDependencies();
    const model = context.model ?? dependencies.defaultModel;
    if (!model) {
      return {
        content: 'No model available to run the sub agent on.',
        isError: true,
      };
    }

    const config = SUB_AGENT_CONFIGS[parsed.agent_type];
    const allowed = new Set<string>(config.allowedTools);
    const tools = dependencies.tools.filter(
      (tool) =>
        allowed.has(tool.definition.name) &&
        // Never allow recursion or user interaction inside a sub agent.
        tool.definition.name !== ToolName.Task
    );

    const run: SubAgentRun = {
      id: context.toolCallId ?? `task-${Date.now()}`,
      agentType: parsed.agent_type,
      description: parsed.description,
      prompt: parsed.prompt,
      status: SubAgentRunStatus.Running,
      messages: [],
      startedAt: new Date().toISOString(),
    };
    const record = (): void => context.recordSubAgentRun?.({ ...run });
    record();
    context.onSubAgentActivity?.({
      phase: SubAgentActivityPhase.Start,
      runId: run.id,
      agentType: run.agentType,
      description: run.description,
      // The live object: its messages array grows as the sub agent works, so
      // an in-process host can show the full transcript mid-run.
      run,
    });

    let toolUseCount = 0;
    const finish = (status: SubAgentRunStatus, summary?: string): void => {
      run.status = status;
      run.endedAt = new Date().toISOString();
      if (summary !== undefined) run.summary = summary;
      record();
      context.onSubAgentActivity?.({
        phase: SubAgentActivityPhase.End,
        runId: run.id,
        agentType: run.agentType,
        description: run.description,
        toolUseCount,
        status,
        ...(summary !== undefined ? { summary } : {}),
      });
    };

    // A session id unique to this run: session-oriented providers (Claude
    // Code) need a real session to expose tools to the model — their ephemeral
    // path is toolless and the model would emit tool calls as prose. Closed in
    // the finally below so finished runs don't leak provider sessions.
    const sessionId = `subagent-${run.id}`;
    try {
      const result = await runSubAgent({
        provider: dependencies.provider,
        model,
        tools,
        prompt: parsed.prompt,
        systemPrompt:
          this.getSystemPrompt?.(parsed.agent_type) ?? config.systemPrompt,
        workspaceRoot: context.workspaceRoot,
        sessionId,
        ...(context.signal ? { signal: context.signal } : {}),
        onMessage: (message) => {
          run.messages.push(message);
          record();
        },
        onToolActivity: (activity) => {
          toolUseCount += 1;
          context.onSubAgentActivity?.({
            phase: SubAgentActivityPhase.Progress,
            runId: run.id,
            agentType: run.agentType,
            description: run.description,
            latestActivity: activity.view.title,
            toolUseCount,
          });
        },
      });
      finish(SubAgentRunStatus.Completed, result.summary);
      return {
        content: result.summary || '(the sub agent returned no report)',
      };
    } catch (error) {
      if (isAbortError(error) || context.signal?.aborted) {
        finish(SubAgentRunStatus.Aborted);
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      finish(SubAgentRunStatus.Failed, message);
      return { content: `Sub agent failed: ${message}`, isError: true };
    } finally {
      try {
        dependencies.provider.closeSession?.(sessionId);
      } catch {
        // Best-effort teardown; a failed close must not mask the run's result.
      }
    }
  }
}

function tryParse(rawArguments: string): TaskArguments | undefined {
  try {
    const parsed = JSON.parse(rawArguments) as Partial<TaskArguments>;
    if (
      typeof parsed.agent_type !== 'string' ||
      !isSubAgentType(parsed.agent_type) ||
      typeof parsed.description !== 'string' ||
      typeof parsed.prompt !== 'string' ||
      parsed.prompt.trim().length === 0
    ) {
      return undefined;
    }
    return {
      agent_type: parsed.agent_type,
      description: parsed.description,
      prompt: parsed.prompt,
    };
  } catch {
    return undefined;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
