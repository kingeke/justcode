/**
 * A tool the model can invoke. Tools live behind this port so the agentic loop in
 * `ChatSessionService` stays provider- and implementation-agnostic: the loop only
 * knows how to advertise definitions, describe a pending call, and execute it.
 */

import type {
  SubAgentActivityEvent,
  SubAgentRun,
} from '@core/domain/sub-agent';
import type { MessageImage } from '@core/domain/message';
import type { TokenUsage } from '@core/ports/chat-model';

/** A function definition advertised to the model (OpenAI function-calling shape). */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema describing the tool's arguments. */
  parameters: Record<string, unknown>;
}

/** The result of executing a tool, fed back to the model as a `tool` message. */
export interface ToolResult {
  content: string;
  isError?: boolean;
  /**
   * Token usage (and cost) the tool itself incurred against the provider —
   * e.g. the `task` tool's sub agent runs, which bill to the same account.
   * The agentic loop folds this into the turn's usage so session token/cost
   * metrics reflect work done inside tools, not just the main model calls.
   */
  usage?: TokenUsage;
  /**
   * Images the tool produced (e.g. frames sampled from a video). Tool messages
   * are text-only on every provider wire, so the agentic loop forwards these as
   * a follow-up `user` message right after the tool result.
   */
  images?: MessageImage[];
}

/** One question in a batch a tool wants to put to the user. */
export interface UserQuestionItem {
  /** Stable id so answers map back to their question after edits/reordering. */
  id: string;
  /** The question to show the user. */
  question: string;
  /** Optional suggested answers the UI may present as a pick-list. */
  options?: string[];
}

/**
 * A batch of questions a tool wants to put to the user, surfaced by the UI as a
 * step-through flow (answer → next/previous → review → submit).
 */
export interface UserQuestionRequest {
  questions: UserQuestionItem[];
}

/** The user's answer to one question; an empty answer means they skipped it. */
export interface UserQuestionAnswer {
  id: string;
  answer: string;
}

export interface ToolExecutionContext {
  workspaceRoot: string;
  signal?: AbortSignal;
  /**
   * Prompts the user and resolves with one answer per question. Provided by the
   * host (the CLI) only for interactive turns; absent in non-interactive
   * contexts, so tools that need it must handle its absence. Rejects if the
   * user cancels.
   */
  askUser?: (request: UserQuestionRequest) => Promise<UserQuestionAnswer[]>;
  /**
   * The id of the tool call being executed. Set by the agentic loop so tools
   * that spawn sub agents (`task`) can link their run to the transcript row.
   */
  toolCallId?: string;
  /**
   * The model the current turn runs on, so a delegating tool (`task`) can run
   * its sub agent on the same model. Set by the agentic loop.
   */
  model?: string;
  /** Live sub agent progress sink, bridged by the agentic loop to the host. */
  onSubAgentActivity?: (event: SubAgentActivityEvent) => void;
  /**
   * Upserts a sub agent run (by `id`) onto the conversation being persisted.
   * Called on run start, as its transcript grows, and on completion so a crash
   * or abort still leaves a reviewable partial transcript.
   */
  recordSubAgentRun?: (run: SubAgentRun) => void;
}

/**
 * A before/after view of a file a tool is about to change, so the UI can render
 * a colored diff. `oldText` is empty when the file is being created.
 */
export interface ToolDiff {
  /** Workspace-relative path being changed. */
  path: string;
  oldText: string;
  newText: string;
}

/**
 * A human-readable view of a pending tool call, used both for rendering tool
 * activity and for the approval prompt.
 */
export interface ToolInvocationView {
  title: string;
  preview?: string;
  /** Structured before/after, when the call changes a file. */
  diff?: ToolDiff;
  /**
   * Workspace-relative path of the primary file the call concerns, when it maps
   * to a single file. Lets a UI make the file openable (e.g. the title links to
   * it) for tools that don't produce a diff, like reads.
   */
  path?: string;
}

export interface Tool {
  readonly definition: ToolDefinition;
  /** Whether the user must approve each invocation before it executes. */
  readonly requiresApproval: boolean;
  /** Summarize a call from its raw JSON arguments (for UI + approval). */
  describe(rawArguments: string): ToolInvocationView;
  /**
   * Optionally compute a before/after diff for the pending call, shown in the
   * UI and approval prompt. Async because it may read the current file from the
   * workspace. Returns undefined when no meaningful diff applies (e.g. the call
   * is invalid or wouldn't change anything).
   */
  previewDiff?(
    rawArguments: string,
    context: ToolExecutionContext
  ): Promise<ToolDiff | undefined>;
  execute(
    rawArguments: string,
    context: ToolExecutionContext
  ): Promise<ToolResult>;
}
