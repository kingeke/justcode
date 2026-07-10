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
  resolveSubAgentConfig,
  type CustomSubAgentConfig,
  type SubAgentRun,
} from '@core/domain/sub-agent';
import { runSubAgent } from '@core/application/sub-agent-runner';

interface TaskArguments {
  /** A built-in {@link SubAgentType} or a custom sub agent's id. */
  agent_type: string;
  description: string;
  prompt: string;
}

/** The provider client and model a sub agent run should execute on. */
export interface ResolvedSubAgentModel {
  provider: ProviderClient;
  model: string;
  /** Provider id backing {@link model}, for the run's "provider · model" display. */
  providerId: string;
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
  /**
   * Resolves the model (and its provider client) a given sub agent type should
   * run on: its configured per-agent default when that model is available, or
   * the fallback `{ provider, model }` otherwise. Any error falls back to the
   * current turn's provider+model. Optional — when unset, sub agents always run
   * on the current provider and `fallbackModel`.
   */
  resolveSubAgentModel?: (
    agentType: string,
    fallbackModel: string
  ) => Promise<ResolvedSubAgentModel>;
}

/**
 * Spawns a sub agent: a child agentic loop that works on a delegated task with
 * a restricted toolset and returns only its final report to the parent model.
 * The run's full transcript is recorded on the conversation (via
 * `context.recordSubAgentRun`) so the user can review what the sub agent did.
 */
export class TaskTool implements Tool {
  public readonly requiresApproval = false;

  public constructor(
    private readonly resolveDependencies: () => TaskToolDependencies,
    /**
     * Returns the system prompt for a sub agent type. Read per run so prompt
     * edits (settings/config) take effect without a rebuild; falls back to the
     * built-in prompt when unset.
     */
    private readonly getSystemPrompt?: (type: SubAgentType) => string,
    /**
     * Returns the user-created sub agents. Read per call (schema and runs) so
     * agents created or deleted at runtime take effect without a rebuild.
     */
    private readonly getCustomSubAgents?: () => Record<
      string,
      CustomSubAgentConfig
    >
  ) {}

  /**
   * Built dynamically so custom sub agents created at runtime appear in the
   * schema (`agent_type` enum + summaries) the next time tools are advertised.
   */
  public get definition(): ToolDefinition {
    const customSubAgents = this.getCustomSubAgents?.() ?? {};
    const typeSummaries = [
      ...Object.entries(SUB_AGENT_CONFIGS).map(
        ([type, config]) => [type, config.summary] as const
      ),
      ...Object.keys(customSubAgents).map(
        (id) =>
          [
            id,
            resolveSubAgentConfig(id, customSubAgents)?.summary ?? '',
          ] as const
      ),
    ]
      .map(([type, summary]) => `"${type}": ${summary}`)
      .join(' ');
    return {
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
            enum: [
              ...Object.values(SubAgentType),
              ...Object.keys(customSubAgents),
            ],
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

    const customSubAgents = this.getCustomSubAgents?.() ?? {};
    const config = resolveSubAgentConfig(parsed.agent_type, customSubAgents);
    if (!config) {
      return {
        content:
          `Unknown agent_type "${parsed.agent_type}": expected one of ` +
          [...Object.values(SubAgentType), ...Object.keys(customSubAgents)]
            .map((type) => `"${type}"`)
            .join(', ') +
          '.',
        isError: true,
      };
    }
    const allowed = new Set<string>(config.allowedTools);
    const tools = dependencies.tools.filter(
      (tool) =>
        allowed.has(tool.definition.name) &&
        // Never allow recursion or user interaction inside a sub agent.
        tool.definition.name !== ToolName.Task
    );

    // Pick the provider + model this run executes on: the agent type's
    // per-agent default when available, otherwise the turn's current
    // provider + model. Resolution never throws — a broken default falls back.
    const target = dependencies.resolveSubAgentModel
      ? await dependencies.resolveSubAgentModel(parsed.agent_type, model)
      : {
          provider: dependencies.provider,
          model,
          providerId: dependencies.provider.providerId,
        };

    const run: SubAgentRun = {
      id: context.toolCallId ?? `task-${Date.now()}`,
      agentType: parsed.agent_type,
      description: parsed.description,
      prompt: parsed.prompt,
      model: target.model,
      providerId: target.providerId,
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
      ...(run.model ? { model: run.model } : {}),
      ...(run.providerId ? { providerId: run.providerId } : {}),
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
        ...(run.model ? { model: run.model } : {}),
        ...(run.providerId ? { providerId: run.providerId } : {}),
        toolUseCount,
        status,
        ...(summary !== undefined ? { summary } : {}),
        ...(run.usage ? { usage: run.usage } : {}),
        ...(run.stats ? { stats: run.stats } : {}),
      });
    };

    // A session id unique to this run: session-oriented providers (Claude
    // Code) need a real session to expose tools to the model — their ephemeral
    // path is toolless and the model would emit tool calls as prose. Closed in
    // the finally below so finished runs don't leak provider sessions.
    const sessionId = `subagent-${run.id}`;
    try {
      const result = await runSubAgent({
        provider: target.provider,
        model: target.model,
        tools,
        prompt: parsed.prompt,
        systemPrompt:
          // Prompt overrides only exist for the built-in types; custom agents
          // carry their prompt on their config (resolved above).
          (isSubAgentType(parsed.agent_type)
            ? this.getSystemPrompt?.(parsed.agent_type)
            : undefined) ?? config.systemPrompt,
        workspaceRoot: context.workspaceRoot,
        sessionId,
        ...(context.signal ? { signal: context.signal } : {}),
        onMessage: (message) => {
          run.messages.push(message);
          record();
        },
        onStats: (stats, stepUsage) => {
          run.stats = stats;
          if (stepUsage) run.usage = stepUsage;
          record();
          // Push a live Progress event so out-of-process hosts (the VSCode
          // webview) update their footer as the run works, not just at the end.
          context.onSubAgentActivity?.({
            phase: SubAgentActivityPhase.Progress,
            runId: run.id,
            agentType: run.agentType,
            description: run.description,
            ...(run.model ? { model: run.model } : {}),
            ...(run.providerId ? { providerId: run.providerId } : {}),
            toolUseCount,
            stats,
            ...(stepUsage ? { usage: stepUsage } : {}),
          });
        },
        onToolActivity: (activity) => {
          toolUseCount += 1;
          context.onSubAgentActivity?.({
            phase: SubAgentActivityPhase.Progress,
            runId: run.id,
            agentType: run.agentType,
            description: run.description,
            ...(run.model ? { model: run.model } : {}),
            ...(run.providerId ? { providerId: run.providerId } : {}),
            latestActivity: activity.view.title,
            toolUseCount,
            ...(run.stats ? { stats: run.stats } : {}),
            ...(run.usage ? { usage: run.usage } : {}),
          });
        },
      });
      if (result.usage) run.usage = result.usage;
      if (result.stats) run.stats = result.stats;
      finish(SubAgentRunStatus.Completed, result.summary);
      return {
        content: result.summary || '(the sub agent returned no report)',
        // The sub agent's calls bill to the same account, so surface its usage
        // to the parent loop to fold into the session's token/cost metrics.
        ...(result.usage ? { usage: result.usage } : {}),
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
        target.provider.closeSession?.(sessionId);
      } catch {
        // Best-effort teardown; a failed close must not mask the run's result.
      }
    }
  }
}

function tryParse(rawArguments: string): TaskArguments | undefined {
  try {
    const parsed = JSON.parse(rawArguments) as Partial<TaskArguments>;
    // agent_type is validated against the known types (built-in + custom) in
    // execute, where the live custom-agent map is available.
    if (
      typeof parsed.agent_type !== 'string' ||
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
