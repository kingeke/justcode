import type { ChatMessage } from '@core/domain/message';
import { ToolName } from '@core/domain/tool-name';
import type { TokenUsage } from '@core/ports/chat-model';

/**
 * The kinds of sub agent the `task` tool can spawn. Each type maps to a
 * {@link SubAgentConfig} describing which tools it may use and how it is
 * prompted.
 */
export enum SubAgentType {
  /** Read-only researcher: explores the workspace/web and reports findings. */
  Explorer = 'explorer',
  /** General-purpose worker: may edit files and run commands to complete a task. */
  General = 'general',
}

/** Lifecycle of a sub agent run, persisted with the conversation. */
export enum SubAgentRunStatus {
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
  Aborted = 'aborted',
}

/**
 * A user-created sub agent as persisted in config, keyed by its id. Custom
 * agents ride the same `task` tool as the built-ins: the model picks them by
 * id, they run with either the read-only (Explorer) or full (General) toolset,
 * and their system prompt falls back to the General prompt when unset.
 */
export interface CustomSubAgentConfig {
  /** Human label shown in the UIs. */
  name: string;
  /** One-line description advertised to the model in the task tool schema. */
  summary?: string;
  /** Optional override; when omitted the agent uses the General prompt. */
  systemPrompt?: string;
  /** When true the agent runs with the read-only Explorer toolset. */
  readOnly?: boolean;
}

/**
 * A sub agent run's own token/throughput metrics, mirroring the main session
 * footer but scoped to just that run. Populated as the run works and persisted
 * with it so the transcript viewer can show them after the fact.
 */
export interface SubAgentRunStats {
  /** Input tokens of the run's most recent request (the "ctx" readout). */
  lastInputTokens: number;
  /** Time from run start to its first streamed token, in ms. */
  ttftMs?: number;
  /** Generation rate of the most recent step, tokens/second. */
  tokensPerSecond?: number;
  /** Running average generation rate across the run's steps. */
  avgTokensPerSecond?: number;
}

/**
 * One sub agent execution, persisted on the conversation (like
 * `previousMessages`, never sent to the model) so its full transcript stays
 * reviewable after the fact.
 */
export interface SubAgentRun {
  /** The parent `task` tool call's id, linking the run to its transcript row. */
  id: string;
  /** A {@link SubAgentType}, or a custom sub agent's config id. */
  agentType: SubAgentType | string;
  /** Short human label for the run (e.g. "Find auth bug"). */
  description: string;
  /** The full prompt the parent model delegated. */
  prompt: string;
  status: SubAgentRunStatus;
  /** The sub agent's own transcript (user prompt, assistant steps, tool results). */
  messages: ChatMessage[];
  startedAt: string;
  endedAt?: string;
  /** The sub agent's final report, returned to the parent as the tool result. */
  summary?: string;
  /** Cumulative token usage (and cost) the run billed to the account. */
  usage?: TokenUsage;
  /** The run's own token/throughput metrics (ctx, ttft, toks/s). */
  stats?: SubAgentRunStats;
}

/** Lifecycle phase of a {@link SubAgentActivityEvent}. */
export enum SubAgentActivityPhase {
  Start = 'start',
  Progress = 'progress',
  End = 'end',
}

/** Live progress event a host subscribes to while sub agents run. */
export interface SubAgentActivityEvent {
  phase: SubAgentActivityPhase;
  runId: string;
  /** A {@link SubAgentType}, or a custom sub agent's config id. */
  agentType: SubAgentType | string;
  description: string;
  /** One-line summary of what the sub agent just did (a tool view title). */
  latestActivity?: string;
  /** Number of tool calls the run has made so far. */
  toolUseCount?: number;
  /** Set on `end` events. */
  status?: SubAgentRunStatus;
  /** The sub agent's final report; set on completed `end` events. */
  summary?: string;
  /** Cumulative token usage (and cost); set on `end` events. */
  usage?: TokenUsage;
  /** The run's own token/throughput metrics; set on `end` events. */
  stats?: SubAgentRunStats;
  /**
   * The live run object (its `messages` array mutates as the sub agent works).
   * Set on `start` events so in-process hosts can serve the full transcript on
   * demand; never serialized across a process boundary.
   */
  run?: SubAgentRun;
}

/** Static configuration of a sub agent type. */
export interface SubAgentConfig {
  /** Tools (by name) the sub agent may call. */
  allowedTools: ToolName[];
  systemPrompt: string;
  /** One-line description used in the `task` tool's schema. */
  summary: string;
}

const SUB_AGENT_SHARED_PROMPT = [
  'You are a sub agent working on a delegated task inside a larger coding session.',
  'You cannot talk to the user — work autonomously with the tools you have and never ask questions.',
  'When the task is done, reply with a single final message: a concise, information-dense report of what you found or did.',
  'That final message is the ONLY thing returned to the agent that delegated to you, so include every fact it needs (paths, symbols, line numbers, decisions).',
].join('\n');

const EXPLORER_TOOLS = [
  ToolName.ReadFile,
  ToolName.Grep,
  ToolName.Glob,
  ToolName.WebFetch,
  ToolName.WebSearch,
];

const GENERAL_TOOLS = [
  ...EXPLORER_TOOLS,
  ToolName.WriteFile,
  ToolName.EditFile,
  ToolName.ApplyPatch,
  ToolName.Bash,
];

export const SUB_AGENT_CONFIGS: Record<SubAgentType, SubAgentConfig> = {
  [SubAgentType.Explorer]: {
    allowedTools: EXPLORER_TOOLS,
    summary:
      'Read-only researcher: searches and reads code or the web and reports findings. Cannot modify anything.',
    systemPrompt: [
      SUB_AGENT_SHARED_PROMPT,
      'You are strictly read-only: never create, edit, or delete files, and never run commands.',
      'Investigate the request with targeted searches and reads, then report your findings.',
    ].join('\n'),
  },
  [SubAgentType.General]: {
    allowedTools: GENERAL_TOOLS,
    summary:
      'General-purpose worker: can read, search, edit files, and run shell commands to complete a delegated task end to end.',
    systemPrompt: [
      SUB_AGENT_SHARED_PROMPT,
      'Complete the delegated task end to end: make the required changes and verify them where possible.',
      'Stay strictly within the scope of the delegated task — never touch unrelated files.',
    ].join('\n'),
  },
};

/** Whether a raw string names a known sub agent type. */
export function isSubAgentType(value: string): value is SubAgentType {
  return (Object.values(SubAgentType) as string[]).includes(value);
}

/**
 * Resolves any agent type — built-in or custom — to the effective config the
 * task tool runs it with. Custom agents get the Explorer toolset when
 * `readOnly`, the General toolset otherwise, and fall back to the General
 * prompt when they don't define one. Returns undefined for unknown types.
 */
export function resolveSubAgentConfig(
  agentType: string,
  customSubAgents: Record<string, CustomSubAgentConfig> = {}
): SubAgentConfig | undefined {
  if (isSubAgentType(agentType)) return SUB_AGENT_CONFIGS[agentType];
  const custom = customSubAgents[agentType];
  if (!custom) return undefined;
  return {
    allowedTools: custom.readOnly ? EXPLORER_TOOLS : GENERAL_TOOLS,
    summary:
      custom.summary?.trim() ||
      `Custom sub agent "${custom.name}"${custom.readOnly ? ' (read-only)' : ''}.`,
    systemPrompt:
      custom.systemPrompt?.trim() ||
      SUB_AGENT_CONFIGS[SubAgentType.General].systemPrompt,
  };
}

/**
 * Slugifies a sub agent name into an id that collides with neither a built-in
 * type nor an existing custom agent (mirrors `uniqueModeId` for chat modes).
 */
export function uniqueSubAgentId(
  name: string,
  existing: Record<string, CustomSubAgentConfig> = {}
): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'agent';
  let id = base;
  let n = 2;
  while (isSubAgentType(id) || existing[id]) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

/**
 * Adds a custom sub agent to a config map, returning the new map and the
 * created agent's id. Returns null when the name is blank. The input map is
 * not mutated.
 */
export function addCustomSubAgent(
  name: string,
  options: Omit<CustomSubAgentConfig, 'name'> = {},
  existing: Record<string, CustomSubAgentConfig> = {}
): {
  id: string;
  customSubAgents: Record<string, CustomSubAgentConfig>;
} | null {
  const trimmedName = name.trim();
  if (!trimmedName) return null;
  const customSubAgents = { ...existing };
  const id = uniqueSubAgentId(trimmedName, customSubAgents);
  const summary = options.summary?.trim();
  const systemPrompt = options.systemPrompt?.trim();
  customSubAgents[id] = {
    name: trimmedName,
    ...(summary ? { summary } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(options.readOnly ? { readOnly: true } : {}),
  };
  return { id, customSubAgents };
}

/**
 * Removes a custom sub agent from a config map, returning the new map. Returns
 * null when the id doesn't name a custom agent (built-ins can't be deleted).
 * The input map is not mutated.
 */
export function removeCustomSubAgent(
  id: string,
  existing: Record<string, CustomSubAgentConfig> = {}
): { customSubAgents: Record<string, CustomSubAgentConfig> } | null {
  if (!existing[id]) return null;
  const customSubAgents = { ...existing };
  delete customSubAgents[id];
  return { customSubAgents };
}
