import type { ChatMessage } from '@core/domain/message';
import { ToolName } from '@core/domain/tool-name';

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
 * One sub agent execution, persisted on the conversation (like
 * `previousMessages`, never sent to the model) so its full transcript stays
 * reviewable after the fact.
 */
export interface SubAgentRun {
  /** The parent `task` tool call's id, linking the run to its transcript row. */
  id: string;
  agentType: SubAgentType;
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
  agentType: SubAgentType;
  description: string;
  /** One-line summary of what the sub agent just did (a tool view title). */
  latestActivity?: string;
  /** Number of tool calls the run has made so far. */
  toolUseCount?: number;
  /** Set on `end` events. */
  status?: SubAgentRunStatus;
  /** The sub agent's final report; set on completed `end` events. */
  summary?: string;
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
